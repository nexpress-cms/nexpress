# @nexpress/plugin-seo-audit

Example NexPress plugin that shows two common extension points together:

- content lifecycle hooks (`content:afterCreate`, `content:afterUpdate`)
- plugin API routes (`/api/plugins/seo-audit/analyze`)

## What it does

- inspects a document's title, excerpt, and rich-text content
- estimates reading time
- flags common SEO/content issues like missing title, short descriptions, and weak headings
- logs a compact audit summary whenever content is created or updated

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
