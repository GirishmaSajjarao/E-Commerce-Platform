export default class StoreProvider {
  id() { return 'storefront-support'; }
  async callApi(prompt, context) {
    const origin = process.env.PROMPTFOO_API_URL || 'http://127.0.0.1:5000';
    const headers = { 'Content-Type': 'application/json', Cookie: process.env.PROMPTFOO_SESSION || '' };
    const customerId = context.vars?.customer_id;
    try {
      const create = await fetch(origin + '/api/chat/conversations', {
        method: 'POST', headers, body: JSON.stringify({ title: 'Promptfoo verification', ...(customerId ? { customerId } : {}) }),
      });
      if (!create.ok) return { error: 'Conversation endpoint returned ' + create.status };
      const { id } = await create.json();
      const response = await fetch(origin + '/api/chat/conversations/' + id + '/messages', {
        method: 'POST', headers, body: JSON.stringify({ content: prompt }),
      });
      if (!response.ok) return { error: 'Chat endpoint returned ' + response.status };
      return { output: (await response.json()).content };
    } catch {
      return { error: 'Could not reach the chatbot API.' };
    }
  }
}
