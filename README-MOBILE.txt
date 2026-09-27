Mr Mahmoud AI — Netlify OneLink

1) Upload this ZIP to Netlify Drop.
2) Make the site public.
3) In Netlify: Site configuration -> Environment variables, add OPENAI_API_KEY.
   Optional: ANTHROPIC_API_KEY, OPENAI_MODEL, CLAUDE_MODEL.
4) Trigger a new deploy after adding variables.
5) Open the site. Backend URL should remain the same site URL.

Important: Netlify Functions are serverless. Local JSON files are not durable storage across invocations. Chat/web/agent calls work, but persistent memory/tasks/projects are not guaranteed until a database/Netlify Blobs layer is added.
