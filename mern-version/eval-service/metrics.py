"""Gemini-backed metric adapters ported from the Python QA implementation."""
import asyncio
import os


def metric_result(name, score, threshold, reason=None, lower_is_better=False):
    score = float(score)
    result = {"name": name, "score": score, "threshold": threshold,
              "passed": score <= threshold if lower_is_better else score >= threshold}
    if reason:
        result["reason"] = str(reason)[:160]
    return result


def deepeval_scorer(key, model, settings):
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    from google import genai
    from deepeval.models import DeepEvalBaseLLM
    from deepeval.metrics import (AnswerRelevancyMetric, ContextualPrecisionMetric, ContextualRecallMetric,
                                  ContextualRelevancyMetric, FaithfulnessMetric, HallucinationMetric)
    from deepeval.test_case import LLMTestCase

    class Judge(DeepEvalBaseLLM):
        def load_model(self):
            return genai.Client(api_key=key)

        def get_model_name(self):
            return f"gemini:{model}"

        def generate(self, prompt, schema=None):
            config = {"response_mime_type": "application/json", "response_schema": schema} if schema else None
            result = self.model.models.generate_content(model=model, contents=prompt, config=config)
            return schema.model_validate_json(result.text) if schema else result.text

        async def a_generate(self, prompt, schema=None):
            return await asyncio.to_thread(self.generate, prompt, schema)

    judge = Judge(model=model)
    kinds = [("Answer Relevancy", AnswerRelevancyMetric), ("Faithfulness", FaithfulnessMetric),
             ("Hallucination", HallucinationMetric), ("Contextual Relevancy", ContextualRelevancyMetric),
             ("Contextual Precision", ContextualPrecisionMetric), ("Contextual Recall", ContextualRecallMetric)]

    def score(scenario, answer):
        context = answer["context"] or ["No relevant information was retrieved."]
        case = LLMTestCase(input=scenario["question"], expected_output=scenario["expected_answer"],
                           actual_output=answer["content"], retrieval_context=context, context=context)
        rows = []
        for name, kind in kinds:
            hallucination = name == "Hallucination"
            threshold = settings["hallucination" if hallucination else "threshold"]
            metric = kind(model=judge, threshold=threshold, async_mode=False, include_reason=True)
            metric.measure(case)
            rows.append(metric_result(name, metric.score, threshold, metric.reason, hallucination))
        return rows
    return score


def ragas_scorer(key, model, settings):
    from google import genai
    from ragas.embeddings import GoogleEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness

    client = genai.Client(api_key=key)
    llm = llm_factory(model, provider="google", client=client)
    embedding = GoogleEmbeddings(client=client, model="gemini-embedding-001")
    metrics = {"faithfulness": Faithfulness(llm=llm), "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=embedding),
               "context_precision": ContextPrecision(llm=llm), "context_recall": ContextRecall(llm=llm)}

    def score(scenario, answer):
        contexts = answer["context"] or ["No relevant information was retrieved."]
        fields = {"user_input": scenario["question"]}
        args = {
            "faithfulness": {"response": answer["content"], "retrieved_contexts": contexts},
            "answer_relevancy": {"response": answer["content"]},
            "context_precision": {"reference": scenario["expected_answer"], "retrieved_contexts": contexts},
            "context_recall": {"reference": scenario["expected_answer"], "retrieved_contexts": contexts},
        }
        return [metric_result(name, metric.score(**fields, **args[name]).value, settings["threshold"])
                for name, metric in metrics.items()]
    return score


def build_scorer(framework, key, model, settings):
    adapter = {"deepeval": deepeval_scorer, "ragas": ragas_scorer}[framework]
    return adapter(key, model, settings)
