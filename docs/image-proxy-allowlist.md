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

## 2026-09-18 addition: MarkTechPost thumbnail host

MarkTechPost article thumbnails are stored as direct WordPress uploads under
`https://www.marktechpost.com/wp-content/uploads/...`. Because the React app loads all article
images through `/api/image-proxy`, Vercel Production/Preview must include `www.marktechpost.com`
in `IMAGE_PROXY_ALLOWED_HOSTS`; otherwise these cards fall back to generated art.

```
www.marktechpost.com
```

## 2026-09-16 additions (41 sources added this session)

Hosts below are the distinct `image_url` hosts of these sources in `public_articles` (verified after
they scraped), except `liquid_ai`, `scale_ai`, `mdsec`, `sentinellabs` (not yet published — derived
by running their `image_selectors` over a live sample). `doyensec` & `schneier` publish no images.
Seven sources reuse hosts already listed above — `langchain` & `greynoise` →
`cdn.prod.website-files.com`; `fireworks_ai` → `cdn.sanity.io`; `baseten`, `wiz_research` &
`intigriti` → `www.datocms-assets.com`; `hacking_articles` → `blogger.googleusercontent.com`.

Verified 2026-09-16: with these entries added, every stored `image_url` for the new sources serves
a valid image through `/api/image-proxy` (200, correct content-type). The images in the app were
blank only because the deployed `IMAGE_PROXY_ALLOWED_HOSTS` had not yet been updated — not a config
problem. Parent domains are used where a source spans subdomains: `kimi.ai` (covers `kimi-file.` +
`statics.`) and `paloaltonetworks.com` (covers `unit42.` + `origin-unit42.`).

**32 new hosts to add:**

```
api-docs.deepseek.com,assets.bishopfox.com,assets.infosecurity-magazine.com,aypchzzf9pftwuto.public.blob.vercel-storage.com,blog.trailofbits.com,cdn.builder.io,cms.therecord.media,cognition.com,cyble.com,eleven-public-cdn.elevenlabs.io,eu-images.contentstack.com,hackingpassion.com,helpnetsecurity.com,horizon3.ai,ik.imagekit.io,img.shields.io,isc.sans.edu,kimi.ai,paloaltonetworks.com,pub-4caceed5c57c4466b559b0834d2806c9.r2.dev,sakana.ai,scale.com,seclists.org,securityaffairs.com,sploitus.com,web-assets.esetstatic.com,www.mdsec.co.uk,www.outflank.nl,www.pentestpartners.com,www.pinecone.io,www.sentinelone.com,www.synacktiv.com
```

### New host → source site

| Host | Scraper site(s) |
| --- | --- |
| `api-docs.deepseek.com` | deepseek |
| `eleven-public-cdn.elevenlabs.io` | elevenlabs |
| `kimi.ai` | kimi (covers `kimi-file.` + `statics.`) |
| `img.shields.io` | kimi (README badge images) |
| `aypchzzf9pftwuto.public.blob.vercel-storage.com` | liquid_ai |
| `www.pinecone.io` | pinecone |
| `sakana.ai` | sakana_ai (see config note below) |
| `cognition.com` | cognition |
| `scale.com` | scale_ai |
| `hackingpassion.com` | hackingpassion |
| `sploitus.com` | sploitus |
| `seclists.org` | full_disclosure, oss_security |
| `horizon3.ai` | horizon3_attack_team |
| `assets.bishopfox.com` | bishop_fox |
| `www.synacktiv.com` | synacktiv |
| `isc.sans.edu` | sans_isc |
| `pub-4caceed5c57c4466b559b0834d2806c9.r2.dev` | 0xdf |
| `paloaltonetworks.com` | unit42 (covers `unit42.` + `origin-unit42.`) |
| `cdn.builder.io` | huntress |
| `web-assets.esetstatic.com` | welivesecurity |
| `blog.trailofbits.com` | trail_of_bits |
| `ik.imagekit.io` | qualys_tru |
| `www.sentinelone.com` | sentinellabs |
| `www.mdsec.co.uk` | mdsec |
| `www.outflank.nl` | outflank |
| `www.pentestpartners.com` | pen_test_partners |
| `cyble.com` | cyble |
| `cms.therecord.media` | the_record |
| `eu-images.contentstack.com` | dark_reading |
| `securityaffairs.com` | security_affairs |
| `helpnetsecurity.com` | help_net_security (covers `img.` + `img2.`) |
| `assets.infosecurity-magazine.com` | infosecurity_magazine |

New multi-tenant CDNs among the above (same shared-bucket caveat as the section below):
`cdn.builder.io`, `ik.imagekit.io`, `eu-images.contentstack.com`, `img.shields.io`, the `*.r2.dev`
(Cloudflare R2) tenant, and the `*.public.blob.vercel-storage.com` tenant.

**Known config bug — `sakana_ai`.** ~4 of 5 sakana posts store a root-relative image path
(`/assets/<slug>/thumbnail.jpg`) because the extractor's `article img[src^='/assets/']` selector
returns the `src` verbatim and `extract.engine` does not absolutize non-meta image srcs (unlike link
discovery). The proxy rejects a relative URL (`400 invalid_url`), so those cards fall back to
generated art regardless of the allowlist. `sakana.ai` is listed for the one post whose image came
from `og:image`. Fix options (separate task): absolutize image src in `extract.engine`, or reorder
sakana's `image_selectors` to prefer `og:image` (a single generic site card for every post).

### Merged value (93 entries) — drop-in replacement for `IMAGE_PROXY_ALLOWED_HOSTS`

```
api-docs.deepseek.com,assets.bishopfox.com,assets.infosecurity-magazine.com,aypchzzf9pftwuto.public.blob.vercel-storage.com,blog.eleuther.ai,blog.jetbrains.com,blog.trailofbits.com,blogger.googleusercontent.com,blogs.nvidia.com,cdn.amazon.science,cdn.builder.io,cdn.prod.website-files.com,cdn.sanity.io,cms.therecord.media,cognition.com,cursor.com,cyberscoop.com,cyble.com,d2908q01vomqb2.cloudfront.net,d3phaj0sisr2ct.cloudfront.net,developer-blogs.nvidia.com,developers.openai.com,eleven-public-cdn.elevenlabs.io,eu-images.contentstack.com,framerusercontent.com,frontend-cdn.perplexity.ai,github.blog,hackingpassion.com,helpnetsecurity.com,horizon3.ai,huggingface.co,i.ytimg.com,ik.imagekit.io,images.ctfassets.net,img.shields.io,isc.sans.edu,kimi.ai,krebsonsecurity.com,lambda.ai,lh3.googleusercontent.com,microsoft.ai,mistral.ai,mitalinlp.oss-cn-hangzhou.aliyuncs.com,mlr.cdn-apple.com,ollama.com,openclaw.ai,paloaltonetworks.com,portswigger.net,projectzero.google,ptht05hbb1ssoooe.public.blob.vercel-storage.com,pub-4caceed5c57c4466b559b0834d2806c9.r2.dev,qianwen-res.oss-accelerate-overseas.aliyuncs.com,qianwen-res.oss-accelerate.aliyuncs.com,qianwen-res.oss-cn-beijing.aliyuncs.com,replicate.com,research.ibm.com,rocm.blogs.amd.com,runway-static-assets.s3.amazonaws.com,sakana.ai,scale.com,seclists.org,securityaffairs.com,specterops.io,sploitus.com,static1.squarespace.com,storage.ghost.io,storage.googleapis.com,thinkingmachines.ai,vllm.ai,weaviate.io,web-assets.esetstatic.com,www.ai21.com,www.anthropic.com,www.bleepstatic.com,www.cybereason.com,www.databricks.com,www.datocms-assets.com,www.exploit-db.com,www.malwarebytes.com,www.marktechpost.com,www.mdsec.co.uk,www.microsoft.com,www.outflank.nl,www.pentestpartners.com,www.pinecone.io,www.rapid7.com,www.salesforce.com,www.securityweek.com,www.sentinelone.com,www.synacktiv.com,www.tenable.com,x.ai,yqintl.alicdn.com
```

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
