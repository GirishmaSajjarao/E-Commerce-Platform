# Cedar Store — MERN storefront and AI support QA

The storefront, API, and evaluation worker live in this directory. The Python
application at the repository root has its own startup commands and database.

## Run the store on Windows

Install Node.js 20 with npm. For Promptfoo, use Node 22.22 or newer for the
whole session, or set `PROMPTFOO_NODE_BINARY` in `server/.env` to the full path
to a separate Node 22.22+ executable.

1. Open PowerShell in this directory and run these commands in order.

   ```powershell
   Set-Location 'C:\Users\sgiri\Downloads\ecommerce-ai-quality-platform-v2\mern-version'
   node --version
   npm.cmd ci
   npm.cmd run setup
   npm.cmd run seed
   npm.cmd run dev
   ```

   The first seed downloads MongoDB 7.0.14 if necessary and starts a temporary
   process using the persistent development data directory. The dev command
   starts the replica set, API, and storefront. Keep that terminal open.
   Once the app is running, use `npm.cmd run qa:dataset` in a second terminal
   to refresh the database-derived evaluation scenarios.

2. Open [the storefront](http://127.0.0.1:5173). The API health endpoint is
   [on port 5000](http://127.0.0.1:5000/api/health). See
   [Swagger UI](http://127.0.0.1:5000/api/docs) or
   [OpenAPI JSON](http://127.0.0.1:5000/api/openapi.json) for the API.

   | Account | Email | Password |
   |---|---|---|
   | Customer | `alice@example.com` | `Customer@123` |
   | Admin | `admin@qa.local` | `Admin@123` |

   Bob and Carol use `bob@example.com` and `carol@example.com` with the same
   customer password. These credentials are development fixtures.

3. Sign in as Alice. Add an item, open the cart, and check out in TEST MODE.
   Use the test card ending in 4242 for success, the supplied card ending in
   0002 for a decline, or the supplied card ending in 9995 for insufficient funds.
   UPI offers simulated outcomes and cash on delivery stays pending until delivered.
   Sign in as admin and use **Administration → Orders** to ship the order.

   For the full test card values, enter these four groups in sequence.

   | Outcome | First group | Second group | Third group | Fourth group |
   |---|---|---|---|---|
   | Success | 4242 | 4242 | 4242 | 4242 |
   | Declined | 4000 | 0000 | 0000 | 0002 |
   | Insufficient funds | 4000 | 0000 | 0000 | 9995 |

### MongoDB alternatives

- **Built-in development replica set.** `npm.cmd run db:dev` starts only
  the database. Its default port is 27017 and data lives in `.data/mongo`.
  To use port 27018, set `$env:DEV_MONGO_PORT = '27018'` in PowerShell and
  `MONGODB_URI=mongodb://127.0.0.1:27018/store?replicaSet=rs0` in
  `server/.env`. Then run seed and dev using that PowerShell window.
- **Docker.** Run `npm.cmd run db:docker`. Wait until `docker compose ps`
  shows MongoDB as healthy. The standard development URI works for Docker.
- **MongoDB Atlas.** Create a cluster and database user, add your IP to the
  cluster’s access list, and paste the Atlas driver URI into `MONGODB_URI`
  in `server/.env`. Include the database name `store` in the URI.

For Docker or Atlas, use `npm.cmd run seed` and `npm.cmd run qa:dataset`,
then start the API and client in two separate PowerShell terminals.

```powershell
npm.cmd run dev -w server
```

```powershell
npm.cmd run dev -w client
```

### Tests and reports

Open a separate PowerShell window in `mern-version`.

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build -w client
npm.cmd exec -w e2e -- playwright install chromium
npm.cmd run test:e2e
```

Playwright starts its own seeded MongoDB, API and storefront, using API port
15001 and browser port 15173. Run it with Node 22.22+ or export
`$env:PROMPTFOO_NODE_BINARY = 'C:\path\to\node.exe'` for the Promptfoo browser
test. The HTML report is at `e2e/playwright-report/index.html`. Failures
save screenshots and traces in `e2e/test-results`.

With the dev app running, run deterministic Promptfoo checks from the QA
page or from a second PowerShell terminal.

```powershell
npm.cmd run qa:promptfoo
```

Console output includes the run ID and result counts. Open **Administration →
AI Quality** to review stored runs, download a JSON report, set score thresholds,
or test the Gemini connection. The deterministic suite runs in mock mode.
Use `npm.cmd run qa:promptfoo -- --rubric` for live rubric grading.

To use Postman, import `docs/Cedar-Store.postman_collection.json`. Enable the
Postman cookie jar and run **Customer checkout**, **Admin fulfillment**, and
**Customer support** in order. The collection uses cash on delivery.

### Gemini and the Python evaluator

Mock mode is the default. It labels each synthetic answer and skips
DeepEval and Ragas with zero scores. For the live chatbot, edit
`server/.env`, set `MOCK_MODE=false` and set `GEMINI_API_KEY`. Set
`GEMINI_MODEL` to a model enabled for your Gemini account. Restart the API
and use **AI Quality → Test connection**.

The evaluator uses Python 3.12 and calls the server over HTTP. The initial
setup generates matching evaluator tokens in the two local env files. If
you started with an older `.env`, set the same random `EVAL_SERVICE_TOKEN`
in `server/.env` and `eval-service/.env`. For live scoring, also set
`MOCK_MODE=false`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in
`eval-service/.env`. Keep both environment files private.

```powershell
Set-Location .\eval-service
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install deepeval==4.3.2
.\.venv\Scripts\python.exe -m pip install --no-deps ragas==0.4.3
.\.venv\Scripts\python.exe -m pip install -r requirements-eval.txt
.\.venv\Scripts\python.exe app.py
```

Open **AI Quality**, set the scenario limit to 3 for a first live run, and
choose **Run DeepEval** or **Run Ragas**. Jobs and scores are persisted by
the API. The evaluator listens on port 5050 and uses the API on port 5000.

### Troubleshooting

- With the dev app running, `npm.cmd run check-setup` checks the replica set,
  API health, chatbot mode, and whether the evaluator token is configured.
- If PowerShell blocks `npm.ps1`, use the `npm.cmd` commands above.
- For port 5000 conflicts, change `PORT` in `server/.env` and
  `VITE_API_PROXY` in `client/.env`. Also update the evaluator’s
  `API_URL` and Postman’s `baseUrl` if you use them.
- A Node engine warning during dependency installation can refer to the pinned
  Promptfoo release. That CLI requires Node 22.22 or newer.
- If MongoDB cannot download on first use, use Docker or Atlas and rerun the seed.
- Run `npm.cmd run qa:dataset` again after changing the store records when you
  want to refresh database-derived QA cases.

### Verification

| Area | Result |
|---|---|
| Windows local replica set, seed, API and storefront startup | Verified on port 27018 |
| Jest and Vitest | Passed locally. See exact counts in [PROGRESS.md](PROGRESS.md) |
| Promptfoo deterministic | 18/18 passed and imported in mock mode |
| Security evaluation | 26/26 mock cases passed |
| DeepEval and Ragas mock behavior | Both HTTP callbacks recorded skipped with zero scores |
| Chromium acceptance | 3/3 passed on Windows, including imported QA results |
| GitHub Actions | Workflow included. Hosted run unverified |
| Live Gemini, live metric scoring, rubric, Docker, Atlas, and Stripe | Live scoring needs a key. Docker and Atlas remain unverified. Stripe is optional and is unimplemented. |

