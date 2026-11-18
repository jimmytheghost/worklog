# Worklog portfolio refresh

Published November 17, 2026 as `worklog-portfolio-20261117-01` at [the Worklog project page](https://www.jimmyweber.com/pages/projects/worklog/).

The page describes the macOS/Windows apps and public browser dashboard, with actual overview and filtered project-history screenshots. It retains the native menu-bar image, corrects the source link, and explains partial coverage, separate account limits, local collection, and the public feed. [Page content](portfolio-content.json) records the portable copy and image mapping.

The banner uses the existing Worklog waveform, Menlo Bold, and the dashboard's green palette over an angled, softened screenshot, following the supplied Tipoff and Ghost Writer references. The same art supplies the gallery thumbnail and a versioned 1200 × 630 social preview. Captures show the already-public dashboard on November 17, 2026. No local service records, credentials, conversations, or feed files were added.

| Source | Dimensions | Published path |
| --- | --- | --- |
| [Banner](images/portfolio/worklog-banner-v2.png) | 1920 × 1080 | `/assets/img/projects/worklog/banner-v2.png` |
| [Social preview](images/portfolio/worklog-preview-v2.jpg) | 1200 × 630 | `/assets/img/projects/worklog/preview-v2.jpg` |
| [Dashboard capture](images/portfolio/worklog-website-overview.jpg) | 1280 × 900 | `/assets/img/projects/worklog/website-overview-v1.jpg` |
| [History capture](images/portfolio/worklog-website-history.jpg) | 1280 × 510 | `/assets/img/projects/worklog/website-history-v1.jpg` |

Recreate the banner/preview with Pillow on macOS:

```sh
python3 scripts/create-portfolio-artwork.py --icon /absolute/path/to/worklog.png
```

Use the original public Worklog app icon from the website asset `/assets/img/projects/worklog.png`. The script accepts another installed font through `--font`; the supplied art uses macOS Menlo Bold. Screenshots are real browser captures, cropped without changing their contents.

Validation passed: PHP lint, Prettier, local HTML regression audit, seven deployed file checksums, twelve public HTTP assertions, canonical browser/Facebook metadata and decoded preview-image checks, and desktop/mobile browser inspection without overflow at 320–1440 px. All six page images decoded. Actual Messages-client rendering was not tested. The existing local `.php` route serves the page directly with canonical metadata; this release did not change aliases or routing.

The live PHP site's release is restricted to four new image files and three Worklog-only content/metadata edits. Website operations retains its frozen plan, backup, and guarded rollback. The public dashboard and its machine-owned feeds were outside the release.

The clean website rebuild has the corresponding content and versioned responsive artwork on its pushed `codex/worklog-portfolio-refresh` branch, commits `5d1208a` and `4346f9d`. That branch remains separate from the rebuild's main branch and production. Its handoff records the validation and browser review.
