# Web app

Marketing page, login, caregiver portal and nurse dashboard in one Next.js app. Every screen
reads and writes through the API in `backend/`; there is no mock data in the app.

```bash
make run               # in the repo root: starts the API and this app together
```

The app needs the API: every screen is filled from it. `make run` starts the API on a free
local port and passes its address to this app. The browser only ever talks to this app:
requests to `/api/...` are forwarded to the API (see `next.config.ts`), so the session
cookie, video seeking and uploads work on one origin.

To run this app on its own against an API you started yourself:

```bash
npm install
API_URL=http://127.0.0.1:8000 npm run dev    # http://localhost:3000, or the next free port
```

`API_URL` defaults to `http://127.0.0.1:8000`, where `make dev` puts the API.

- `/` marketing
- `/login` username or email, and password (`LOGINS.md` has the six shared agency logins)
- `/signup` create a nurse or caregiver account, optionally with an agency code
- `/portal` caregiver portal
- `/dashboard` nurse dashboard

Where things are:

| Path | What it is |
| --- | --- |
| `src/shared/brand.ts` | The product name and tagline. The name is a placeholder; change it here only. |
| `src/lib/api.ts`, `types.ts`, `hooks.ts` | API client, the API's response shapes, data-loading hooks |
| `src/lib/status.ts` | The label and colour of every state, shared by both portals |
| `src/lib/segment.ts` | Playing one stretch of a video and stopping at its end |
| `src/lib/recorder.ts` | Camera recording with a file-upload fallback; its resolution, bitrate and length limit |
| `src/lib/upload.ts` | The largest video that can be sent (`MAX_UPLOAD_BYTES`) |
| `src/components/ui`, `src/components/media` | The one UI kit, and the video / time-range / job-progress pieces |
| `src/components/media/StepChapters.tsx`, `chapters.ts` | The step chapters bar under every video with steps: a segment per timed step, the current step named, Previous / Next |
| `src/shared` | Auth provider, login form, role gate, logo, public pages |
| `src/nurse`, `src/app/dashboard` | Nurse dashboard |
| `src/shared/layout` | What both portals' frames are built from: the rail, the account menu, the page heading, the back link |
| `src/caregiver`, `src/app/portal` | Caregiver portal. A phone gets one narrow column with the pages along the bottom; from the `lg` width (1024px) it uses the dashboard's frame and lays each page out in columns. |
