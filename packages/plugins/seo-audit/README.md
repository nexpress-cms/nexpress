# @nexpress/plugin-seo-audit

Example NexPress plugin that shows two common extension points together:

- content lifecycle hooks (`content:afterCreate`, `content:afterUpdate`)
- plugin API routes (`/api/plugins/seo-audit/analyze`)

## What it does

- inspects a document's title, excerpt, and rich-text content
- estimates reading time
- flags common SEO/content issues like missing title, short descriptions, and weak headings
- logs a compact audit summary whenever content is created or updated

## Configuration

Open `/admin/plugins/seo-audit` after the framework boots. The G.1 auto-form renders the operator-tunable thresholds:

| Field                 | Type    | Default | Range       |
|-----------------------|---------|---------|-------------|
| Title min             | number  | 30      | 0 – 200     |
| Title max             | number  | 60      | 10 – 300    |
| Description min       | number  | 70      | 0 – 500     |
| Description max       | number  | 160     | 50 – 500    |
| Min body words        | number  | 250     | 0 – 10000   |
| Include description   | boolean | true    | —           |

Saved values persist to `np_settings (key="plugin.config:seo-audit")` and are read by the audit logic on every hook / route fire (no restart needed for threshold changes — operator-tunable in real time).

> **Pre-G.2.3 note**: earlier versions of the plugin shipped a hand-rolled `admin.settings.fields` form for the same thresholds, but the form's values were never read — the audit logic used hardcoded constants. G.2.3 wires the operator's choices into the audit logic.

## Route usage

### GET

```bash
curl "http://localhost:3000/api/plugins/seo-audit/analyze?title=Hello&description=Short&content=Body"
```

### POST

```bash
curl -X POST "http://localhost:3000/api/plugins/seo-audit/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "How to Run a Content Audit",
    "description": "A practical guide to reviewing content quality and metadata in NexPress.",
    "content": "Start with your audience intent..."
  }'
```
