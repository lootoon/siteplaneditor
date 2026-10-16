# TakeOff: free internet demo

This package is prepared for Render's Free Python web service. It has not yet been deployed to your account.

## 1. Upload the extracted files to GitHub

1. Extract this ZIP on your PC. Do not upload the ZIP itself to GitHub.
2. Sign in at https://github.com and choose New repository.
3. Name it `takeoff-demo`, select Private, and create the repository.
4. Choose "uploading an existing file" (or Add file > Upload files).
5. Drag the extracted contents into the upload area, including the `server` and `static` folders. Commit the upload.
6. Confirm that `render.yaml`, `requirements.txt`, `.python-version`, and `server` are visible at the repository root, not inside another folder. Include `.gitignore` too.

## 2. Deploy with Render

1. Sign in at https://dashboard.render.com.
2. Choose New > Blueprint and connect your GitHub account. Grant access to this repository.
3. Select `takeoff-demo`. Render reads `render.yaml`.
4. Enter TAKEOFF_PASSWORD when prompted. Use a unique password of at least 12 characters. Do not put it in GitHub.
5. Check that the web service instance is Free before deploying. No database or paid disk is included in this configuration.
6. Deploy and wait for the service to become Live.
7. Open the HTTPS URL shown by Render and sign in. Share that URL and the password privately with your testers.

The Blueprint generates a session secret and uses Python 3.12, with the latest available patch version. It starts the server using:

    uvicorn server.main:app --host 0.0.0.0 --port $PORT

If using New > Web Service instead of Blueprint, select Python and Free, set the build command to `pip install -r requirements.txt`, use the start command above, and set the health check path to `/healthz`. Set TAKEOFF_PASSWORD (12+ characters), TAKEOFF_SESSION_SECRET (a random secret of at least 32 characters), and TAKEOFF_DATA (`/tmp/takeoff-data`) in Environment before deploying. Include `.python-version` in the repository.

## 3. Test from an iPad

Open the Render HTTPS URL in Safari, sign in, create a test project, upload a small PDF from Files, and try scale calibration, length/area measurement, BQ quantity updates and export. Start in landscape orientation. Check saving and reopening a `.takeoff` file using the Files app.

Hosting makes the app reachable; it does not establish iPad compatibility. The current UI has pointer events, but also uses double-click, right-click and keyboard shortcuts. Apple Pencil, touch gestures, measurement completion and layout still need testing on a physical iPad. No tablet interface changes are included in this hosting update.

## Free-plan storage limitations

Render sleeps after 15 minutes without incoming traffic. Waking can take about a minute. Files written by the app, including PDFs and its SQLite database, are lost on restart, redeploy or spin-down. The configured data directory is temporary; it does not provide persistence.

Use File > Save project file (.takeoff) frequently, especially before leaving the app. This package contains project data and linked PDFs so you can import it again after a reset. BQ Excel exports alone are not a complete project backup. This free setup is for disposable demo data.

All testers share ONE password, ONE project list, and ONE signature library. They can edit/delete each other's projects. Create separately named test projects and avoid simultaneous editing of the same project; there is no merge/conflict handling. Separate user accounts are not implemented.

The password is set by TAKEOFF_PASSWORD on every startup, so a filesystem reset cannot reopen first-time password setup. To change it, update that variable in Render and restart. Rotate TAKEOFF_SESSION_SECRET as well to sign out existing sessions. The in-app password-change endpoint is disabled when the environment password is used.

For retained projects later, add durable storage for both SQLite and PDFs (for example a paid persistent disk), point TAKEOFF_DATA to its mount directory and run one service instance. Back up separately.

## Local Windows use

`run.bat` still works as before. Without hosting environment variables, first-time password setup remains available and data stays in `%LOCALAPPDATA%\TakeOff`.

## Changes included

- Free Render Blueprint, Python version selection and Git ignore rules.
- Environment-managed hosted password and session secret support.
- Startup refuses to run on Render without a password of at least 12 characters.
- HTTPS-only session cookie on Render and a public `/healthz` health endpoint.
- Removed bundled Python cache files from the ZIP.
- Existing measurement, drawing, export and BQ code retained.

## Official references

- https://render.com/docs/deploy-fastapi
- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
- https://render.com/docs/python-version

## Validation performed

Local automated checks passed for desktop and hosted configuration: authentication, protected routes, HTTPS cookie setting, health endpoint, static assets, project creation/saving, PDF upload/download, and full project export/import. Hosted startup rejects a missing password. These are local backend checks, not a live Render deployment or physical iPad test.
