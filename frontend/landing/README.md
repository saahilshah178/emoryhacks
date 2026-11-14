# Web app

Marketing page, login, caregiver portal and nurse dashboard in one Next.js app. Every screen
reads and writes through the API in `backend/`; there is no mock data in the app.

```bash
npm install
npm run dev            # http://localhost:3000 (the next free port if 3000 is taken)
```

The API must be running too (`make dev` in the repo root, port 8000). The browser only ever
talks to this app: requests to `/api/...` are forwarded to the API (see `next.config.ts`), so
the session cookie, video seeking and uploads work on one origin. Point at another API with
`API_URL=http://127.0.0.1:8001 npm run dev`.

- `/` marketing
- `/login` and `/signup`
- `/portal` caregiver portal
- `/dashboard` nurse dashboard

Where things are:

| Path | What it is |
| --- | --- |
| `src/shared/brand.ts` | The product name and tagline. The name is a placeholder; change it here only. |
| `src/lib/api.ts`, `types.ts`, `hooks.ts` | API client, the API's response shapes, data-loading hooks |
| `src/lib/status.ts` | The label and colour of every state, shared by both portals |
| `src/lib/segment.ts` | Playing one stretch of a video and stopping at its end |
| `src/lib/recorder.ts` | Camera recording with a file-upload fallback |
| `src/components/ui`, `src/components/media` | The one UI kit, and the video / time-range / job-progress pieces |
| `src/shared` | Auth provider, login form, role gate, logo, public pages |
| `src/nurse`, `src/app/dashboard` | Nurse dashboard |
| `src/caregiver`, `src/app/portal` | Caregiver portal |
