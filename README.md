# AKTU PLACEMENT ANALYTICS

*Statistical Analysis and Prediction of Placement Records of AKTU Affiliated Colleges*

A static website (HTML + CSS + JavaScript, no backend, no build step). Works on GitHub Pages and is edited in VS Code.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure, title banner, sticky navigation buttons |
| `style.css` | Blue/white theme, cards, buttons, responsive layout |
| `script.js` | All logic (cleaning, statistics, regression, evaluation) and the pages |
| `placement_data_filled.csv` | Your dataset (the site reads this file) |
| `data.js` | Backup copy of the CSV, used only if the CSV cannot be fetched (e.g. double-click opening) |
| `.gitignore` | Files Git should ignore |

Charts use Chart.js and PapaParse from a CDN, so an internet connection is needed when you open the site.

## Run locally (VS Code Live Server)

Opening `index.html` by double-click blocks `fetch()` for local files, so use a tiny local server:

1. Install VS Code, then open it and go to **Extensions** (square icon, left bar).
2. Search **Live Server** (by Ritwick Dey) and click **Install**.
3. **File → Open Folder…** and choose this project folder.
4. Right-click `index.html` in the file list and choose **Open with Live Server** (or click **Go Live** at the bottom right).
5. The browser opens, usually at `http://127.0.0.1:5500`. Edit the CSV or code, save, and the page refreshes.

If you double-click `index.html` anyway, the site falls back to `data.js` and shows a note saying so. Editing the CSV will then have no effect until you use Live Server.

## Methodology (kept from the project)

- **College-level** analysis uses only rows where `Branch = "Overall"`. Overall and branch rows are never mixed. Branch-level statistics use only the branch rows.
- `Mis` / `MIS` are merged into one branch name, `MIS`.
- **Placement %** = `placed_students / total_student × 100`, recomputed. The CSV value for IET lucknow 2024-25 (67.71%) is wrong; the correct value is 518 / 845 = 61.30%. The button under the navigation bar switches to the CSV value.
- Missing values (packages, missing totals) are never treated as zero; the site shows "Not reported".
- **Statistics:** mean, median, mode ("No mode" if nothing repeats), sample variance (n − 1), standard deviation, min, max, quartiles (linear interpolation), frequency table with class width 10, histogram, box plot.
- **Prediction:** one least-squares line per college (placement % vs year), estimate for 2026-27 clipped to 0–100. Colleges with fewer than 2 records show a message instead of a prediction.
- **Model evaluation:** colleges with at least 3 records are trained on all years except the latest and tested on the latest year. MAE, MSE, RMSE and R² use the pooled test points (only a few, so treat them as rough).

## Check values (recomputed placement %)

| Item | Value |
|---|---|
| Mean of Overall records | 41.93% |
| IET lucknow, 2026-27 | about 77.48% |
| MAE / RMSE / R² | 7.996 / 9.909 / 0.803 |

## Updating the data

Replace `placement_data_filled.csv` with the new file, keeping the same column names. To keep the backup in sync, also paste the CSV text into `data.js` between the backticks (or delete `data.js` and its `<script>` line in `index.html` if you always use Live Server / GitHub Pages).

## Publish on GitHub Pages

1. Create an account at github.com, then in VS Code open the project folder.
2. Click the **Source Control** icon (branch symbol, left bar) and click **Initialize Repository**.
3. Type a message such as `first version`, click **Commit** (choose "Yes" if asked to stage all changes).
4. Click **Publish Branch**, sign in to GitHub when asked, choose **Public**, and wait for it to finish.
5. On github.com open your repository → **Settings → Pages**.
6. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then **Save**.
7. After 1–2 minutes your link appears: `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

Later changes: edit, save, write a commit message, click **Commit**, then **Sync Changes**. The live site updates in a minute or two.
