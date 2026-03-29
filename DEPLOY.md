# Deploying To `digital-chemistry.io/zif/`

This app is packaged so it can be proxied directly under `/zif/` without rewriting route paths inside the Flask app.

## What the server needs

- Docker
- Docker Compose
- a reverse proxy such as Nginx or Caddy

## Quick deploy

1. Copy the repository to the server.
2. From the repo root, run:

```bash
docker compose up -d --build
```

3. Open `http://SERVER_IP:8000/zif/` to verify the container directly.

If that works, connect the public site to the container through the reverse proxy.

## Nginx example for `digital-chemistry.io/zif/`

Important:
- keep the `/zif/` prefix when proxying
- do not strip the prefix in `proxy_pass`

```nginx
location = /zif {
    return 301 /zif/;
}

location /zif/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
}
```

## Updating later

From the repo root:

```bash
git pull
docker compose up -d --build
```

## Notes

- The WSGI entry point mounts the app at `/zif`.
- Frontend API calls are prefix-aware, so `/zif/api/...` works correctly.
- The summary JSON is included in the container. ATR/XRD/image folders are used when present in the repo copy on the server.
