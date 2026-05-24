---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/theme": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Fix bundled-theme archive and project-link regressions: theme seeds can now attach posts to categories, `findPosts` resolves hasMany relationship filters through registered join tables, magazine section/category archives render seeded category posts, and portfolio project cards link to `/work/:slug`.
