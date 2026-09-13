# Image Proxy Host Allowlist

Value for the `IMAGE_PROXY_ALLOWED_HOSTS` environment variable (Vercel Production + Preview).

Generated 2026-09-04 from every distinct `image_url` host in `articles` / `public_articles`
(2,948 rows with images across all 71 scraper configs — both tables yielded an identical host set).

Matching rule ([lib/imageProxy.js:81-83](../lib/imageProxy.js#L81-L83)): an entry matches when the
hostname equals it **or** ends with `.<entry>`, so a parent domain covers its subdomains. Three
observed hosts are therefore omitted as redundant: `cdn-uploads.huggingface.co` and
`cdn-thumbnails.huggingface.co` (covered by `huggingface.co`), and `media.x.ai` (covered by `x.ai`).

## Value (60 entries)

```
blog.eleuther.ai,blog.jetbrains.com,blogger.googleusercontent.com,blogs.nvidia.com,cdn.amazon.science,cdn.prod.website-files.com,cdn.sanity.io,cursor.com,cyberscoop.com,d2908q01vomqb2.cloudfront.net,d3phaj0sisr2ct.cloudfront.net,developer-blogs.nvidia.com,developers.openai.com,framerusercontent.com,frontend-cdn.perplexity.ai,github.blog,huggingface.co,i.ytimg.com,images.ctfassets.net,krebsonsecurity.com,lambda.ai,lh3.googleusercontent.com,microsoft.ai,mistral.ai,mitalinlp.oss-cn-hangzhou.aliyuncs.com,mlr.cdn-apple.com,ollama.com,openclaw.ai,portswigger.net,projectzero.google,ptht05hbb1ssoooe.public.blob.vercel-storage.com,qianwen-res.oss-accelerate-overseas.aliyuncs.com,qianwen-res.oss-accelerate.aliyuncs.com,qianwen-res.oss-cn-beijing.aliyuncs.com,replicate.com,research.ibm.com,rocm.blogs.amd.com,runway-static-assets.s3.amazonaws.com,specterops.io,static1.squarespace.com,storage.ghost.io,storage.googleapis.com,thinkingmachines.ai,vllm.ai,weaviate.io,www.ai21.com,www.anthropic.com,www.bleepstatic.com,www.cybereason.com,www.databricks.com,www.datocms-assets.com,www.exploit-db.com,www.malwarebytes.com,www.microsoft.com,www.rapid7.com,www.salesforce.com,www.securityweek.com,www.tenable.com,x.ai,yqintl.alicdn.com
```

## Host → source site

| Host | Images | Scraper sites |
| --- | ---: | --- |
| `images.ctfassets.net` | 551 | open_ai, open_ai_releases |
| `huggingface.co` (+ `cdn-uploads.`, `cdn-thumbnails.`) | 459 | huggingface_blog |
| `cdn.prod.website-files.com` | 321 | claude_blog, coreweave, modular, threatlocker_blog, together_ai_blog |
| `www.cybereason.com` | 199 | cybereason_blog |
| `cdn.sanity.io` | 101 | anthropic_news, cerebras_blog, cohere_blog, groq_blog, perplexity_blog |
| `storage.googleapis.com` | 90 | google_cloud_ai, google_cloud_threat_intel, google_deepmind, google_innovation_ai, google_research |
| `mistral.ai` | 82 | mistral_ai |
| `blogger.googleusercontent.com` | 81 | hackernews |
| `x.ai` (+ `media.`) | 78 | x_ai_news |
| `www.securityweek.com` | 72 | securityweek |
| `www.exploit-db.com` | 59 | exploit_db |
| `specterops.io` | 51 | specterops_blog |
| `storage.ghost.io` | 50 | roboflow, talos_intelligence, watchtowr_labs |
| `yqintl.alicdn.com` | 41 | alibaba |
| `cyberscoop.com` | 39 | cyberscoop |
| `d2908q01vomqb2.cloudfront.net` | 38 | aws_ml_blog |
| `www.bleepstatic.com` | 37 | bleepingcomputer |
| `microsoft.ai` | 29 | microsoft_ai_blog |
| `frontend-cdn.perplexity.ai` | 27 | perplexity_blog |
| `www.rapid7.com` | 25 | rapid7_blog |
| `www.malwarebytes.com` | 24 | malwarebytes_blog |
| `blogs.nvidia.com` | 22 | nvidia |
| `www.microsoft.com` | 22 | microsoft_research, microsoft_security_research |
| `vllm.ai` | 20 | vllm |
| `replicate.com` | 20 | replicate |
| `static1.squarespace.com` | 20 | stability_ai |
| `ollama.com` | 20 | ollama |
| `blog.eleuther.ai` | 20 | eleuther_ai |
| `cdn.amazon.science` | 20 | amazon_science |
| `www.datocms-assets.com` | 20 | allen_ai |
| `framerusercontent.com` | 19 | inflection_ai_blog |
| `research.ibm.com` | 18 | ibm_research_ai |
| `www.salesforce.com` | 18 | salesforce_ai_research |
| `ptht05hbb1ssoooe.public.blob.vercel-storage.com` | 17 | cursor_blog |
| `projectzero.google` | 16 | project_zero |
| `krebsonsecurity.com` | 15 | krebs_on_security |
| `developer-blogs.nvidia.com` | 15 | nvidia_developer |
| `www.databricks.com` | 14 | databricks_genai_blog |
| `openclaw.ai` | 14 | openclaw_blog |
| `www.ai21.com` | 13 | ai21_labs |
| `mlr.cdn-apple.com` | 13 | apple_ml_research |
| `developers.openai.com` | 12 | openai_codex_blog |
| `blog.jetbrains.com` | 12 | jetbrains_ai |
| `weaviate.io` | 12 | weaviate |
| `qianwen-res.oss-*.aliyuncs.com`, `mitalinlp.oss-cn-hangzhou.aliyuncs.com` | 19 | qwen |
| `portswigger.net` | 10 | portswigger_blog |
| `www.tenable.com` | 10 | tenable_blog |
| `rocm.blogs.amd.com` | 10 | amd_rocm |
| `lambda.ai` | 10 | lambda |
| `github.blog` | 10 | github_ai |
| `lh3.googleusercontent.com` | 8 | google_deepmind |
| `www.anthropic.com` | 7 | anthropic_news |
| `d3phaj0sisr2ct.cloudfront.net`, `runway-static-assets.s3.amazonaws.com` | 9 | runway_research |
| `thinkingmachines.ai` | 7 | thinking_machines |
| `cursor.com`, `i.ytimg.com` | 2 | cursor_blog |

Four configured sites store no images at all and need no entry: `cert_cc_vulnotes`,
`cisa_advisories`, `okta_security_advisories`, `zero_day_initiative`.

## Notes

- **No CSP change needed.** The React app rewrites every image through
  `/api/image-proxy?url=…` ([react-app/src/App.jsx:37](../react-app/src/App.jsx#L37)), so images are
  same-origin and the `img-src 'self'` directive in [vercel.json](../vercel.json) already covers them.
- **Redirects are re-validated per hop**, so a host that 301s to a different hostname needs both in
  the list. The `www.*` entries are listed exactly as stored; if an upstream starts redirecting
  `www.X` → `X` (or vice versa) the fetch will 400 until the apex is added.
- **Multi-tenant CDNs.** `storage.googleapis.com`, `cdn.sanity.io`, `cdn.prod.website-files.com`,
  `framerusercontent.com`, `static1.squarespace.com`, `storage.ghost.io`, `images.ctfassets.net`,
  `*.cloudfront.net`, `*.aliyuncs.com` and `*.public.blob.vercel-storage.com` are shared buckets —
  allowing them admits any tenant's assets on that host, not just ours. That is unavoidable without
  path-level rules; the proxy's size cap, SVG block, and content-type sniffing are the mitigations.
- **Regenerate** after adding scraper configs: take the distinct hosts of `image_url` from
  `public_articles` and drop any covered by a listed parent domain.
