# Manual checks that need your real credentials

Workflow A with two real providers and one subscription CLI (Phase 1 definition of done).

1. `docker compose up --build -d`, sign in as admin.
2. Settings → API keys: add an Anthropic key and an OpenAI (or Gemini/OpenRouter) key. Both must show *active* after "Save & test".
3. Admin → Providers & models → *Refresh models* for each provider. Check prices; set any missing ones.
4. New project, pick provider 1's model in the chat header, send:
   "Create a tiny Flask or Node hello-world site, run it, and show it in the preview."
   Expect: tool cards (fs_write, shell_exec, preview_register), a rendering Preview tab, files in the tree, usage rows.
5. Switch the conversation model to provider 2 and send "Add a /health endpoint and a test, run the test."
   Expect the Tests tab to show a result and the Usage tab to list both providers.
6. Subscription: build the cli image (`docker compose --profile cli build cli-runner`), log in (README), set `CLI_RUNNER_ENABLED=true`, restart api,
   Admin → Subscriptions → Check status (should read *logged in*) → Enable, then pick the CLI in the model menu and repeat step 4.
7. Invite a member, grant a shared key with a $0.05 daily quota, send messages until blocked; confirm own-key requests still work.
