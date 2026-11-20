# MERN Store and Support QA

This local application is separate from the Python project at the repository root.

## Run locally on Windows

Open PowerShell with Node.js 20 and npm available.

```powershell
Set-Location 'C:\Users\sgiri\Downloads\ecommerce-ai-quality-platform-v2\mern-version'
node --version
npm.cmd ci
npm.cmd run setup
npm.cmd run db:dev
```

Keep the database terminal running. Its first run downloads the MongoDB binary.
In a second PowerShell terminal, in `mern-version`:

```powershell
npm.cmd run seed
npm.cmd run dev -w server
```

For this first run, start the storefront in a third PowerShell terminal with
`npm.cmd run dev -w client` and open `http://127.0.0.1:5173`. On subsequent runs,
`npm.cmd run dev` starts the database, API, and storefront together.

API health is at `http://127.0.0.1:5000/api/health` and API documentation is at
`http://127.0.0.1:5000/api/docs`. Development accounts are
`admin@qa.local / Admin@123` and `alice@example.com / Customer@123` (also bob and carol).

Run the current tests with `npm.cmd test`. Jest uses its own temporary replica set.

### Alternative database setups

- Docker Desktop with Compose: run `npm.cmd run db:docker` and wait for the
  container to be healthy. Then seed and start the server in the second terminal.
- MongoDB Atlas: create a cluster and database user, allow your IP, and put the
  driver connection string with database name `store` in `server/.env` as
  `MONGODB_URI`. Then seed and start the server. The Atlas cluster supplies replica-set support.

Use one database option at a time. To leave an existing MongoDB process on port
27017, set `$env:DEV_MONGO_PORT = '27018'` in the terminal that starts the
development database and set `MONGODB_URI=mongodb://127.0.0.1:27018/store?replicaSet=rs0`
in `server/.env`. If port 5000 is occupied, update
`PORT` in `server/.env` and `VITE_API_PROXY` in `client/.env`.

See [PROGRESS.md](PROGRESS.md) for verification and pending features.
