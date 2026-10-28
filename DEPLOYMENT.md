# Skill Nova backend deployment

## Runtime and environments

Use a supported Node.js 20+ release (the container uses Node 22) and MongoDB. Set `NODE_ENV` to `development`, `staging`, or `production`; `.env.example`, `.env.staging.example`, and `.env.production.example` are templates only. Copy the appropriate template into your deployment secret manager or an untracked local `.env` file, then replace every placeholder. `.env*` files are excluded from Git and Docker build contexts.

Production requires a reachable non-local MongoDB URI, a non-empty exact allowlist in `CORS_ORIGINS`, and a strong unique `JWT_ACCESS_SECRET` (at least 32 characters; generate with a cryptographic random generator). Use MongoDB TLS and authentication, a least-privilege database user, and a managed secrets store. Never put credentials in image layers, source, build arguments, or logs. Keep `APP_URL` HTTPS and terminate TLS at a trusted ingress/load balancer; enable `TRUST_PROXY=true` only when traffic can reach the app through that trusted proxy. Configure the ingress to redirect HTTP to HTTPS and set HSTS there as appropriate.

Set `PRIVATE_DOCUMENT_STORAGE_PATH` to a private persistent volume with restrictive ownership/permissions. The current provider stores private files on local disk. Before running multiple replicas or relying on cloud object storage, replace it with a durable private provider behind `DocumentStorageProvider`; never expose the bucket or directory publicly. The current general API rate limiter uses process memory. For multiple replicas, deploy a shared rate-limit store before scaling out, otherwise limits are per replica. Auth endpoints also have a stricter limiter.

## Install, configure, build, run, and test

```sh
npm ci
cp .env.example .env
# Edit .env with local MongoDB and a generated development JWT secret.
npm run dev
```

For staging/production, inject variables from the deployment secret manager rather than copying secrets into a repository. Build and validate before release:

```sh
npm ci
npm run build
npm test
npm start
```

`npm start` expects `dist/` from the build and a configured MongoDB connection. Startup fails if it cannot connect. `GET /api/v1/health` reports application/environment/database/timestamp and returns `503` until MongoDB is connected, so it can be used as a readiness and container health check. The process handles `SIGTERM`/`SIGINT`, stops accepting requests, closes MongoDB, and has a bounded shutdown timeout. Logs are structured JSON outside development; request IDs are included and credentials/password fields are redacted. `src/config/error-monitor.ts` is the integration point for installing an APM/error-monitor provider during bootstrap.

## Container deployment

Build and run without embedding secrets in the image:

```sh
docker build -t skill-nova-backend:<release> .
docker run --rm --name skill-nova-backend \
  --env-file /secure/path/backend.env \
  -p 3000:3000 \
  --mount type=volume,src=skill-nova-private-documents,dst=/var/lib/skill-nova/private-documents \
  skill-nova-backend:<release>
```

The runtime image uses a non-root user, production dependencies only, and a Docker health check. Configure the orchestrator with the same health URL and a termination grace period longer than the 25-second shutdown timeout. Keep databases and private storage on services/volumes that are not publicly reachable. Restrict network ingress to the TLS proxy and required monitoring/administration sources. CORS is an application browser policy; it does not replace network access controls or authentication.

## Index and migration strategy

Mongoose schema indexes are the versioned index definitions. Automatic index creation is enabled outside production and disabled in production to avoid surprise index builds during API startup. For a release that adds or changes indexes:

1. Review the schema/index diff and check for duplicate/conflicting existing data.
2. Take and verify a backup, then run the built index task against the intended database: `npm run build` followed by `npm run db:indexes`.
3. Watch database CPU, disk, and index-build progress; test the new query plan in staging first.
4. Deploy API instances after required indexes are ready. Keep schema changes backward compatible across rolling deployments; use expand/migrate/contract for data migrations.

The index task loads API route modules to register all models and calls `createIndexes()`; it does not drop or rewrite existing indexes. Run it as a controlled deployment job with production credentials and do not run it against an unintended database.

## Deploy and rollback

Deploy immutable, version-tagged images. Apply reviewed index/data migration steps, deploy the image, wait for the health check, and monitor error rate, latency, MongoDB pool/replication health, disk, and backup status. Keep the previous image and compatible configuration available for rollback. Roll back by redeploying the previous image and verify health; do not automatically reverse a forward data migration. If a schema/data change is not backward compatible, use its documented recovery plan and a verified backup rather than assuming an image rollback is sufficient.

## Backup and restore

Use MongoDB Atlas/provider point-in-time recovery or scheduled encrypted backups, with retention and access control appropriate for student and financial data. Back up private document storage separately and consistently with the database. Store backup encryption keys separately from backup data, monitor job success, and perform regular restore drills in an isolated environment.

Example logical dump (use the URI from a protected secret environment; avoid shell history or logs containing credentials):

```sh
mongodump --uri="$MONGO_URI" --archive=skill-nova-$(date -u +%Y%m%dT%H%M%SZ).archive.gz --gzip
```

Restore into a new isolated database first, validate collections/indexes and application reads, and only then perform a controlled production recovery. `--drop` deletes target collections, so use it only after confirming the target and obtaining the required operational approval:

```sh
mongorestore --uri="$RESTORE_MONGO_URI" --archive=skill-nova-backup.archive.gz --gzip
```

For point-in-time recovery, follow the database provider's documented procedure. Restore the matching private-file backup as well; file references in MongoDB must resolve to the restored private storage. Record restore time, source backup, validation results, and any recovery-point gap.

## Production checklist

- TLS/HTTPS at a trusted ingress; only approved origins in `CORS_ORIGINS`.
- Secret manager values for MongoDB, JWT, and provider credentials; no secrets in source/images.
- Production MongoDB with TLS, authentication, least privilege, backups, and tested restore.
- Private, durable file storage with authenticated downloads and no public object URLs.
- Shared rate-limit storage before horizontal scaling.
- Health checks, structured logs, request IDs, error-monitor provider, and alerts.
- Reviewed index rollout, deployment rollback plan, and restore drill.
