# 60-second demo — voiceover script

Timecodes match `demo.mp4` (silent) and `demo.srt`. Read at a calm pace; each line is ~3–4 s.

## 0:00–0:12 · intro (phone: launching the app from the home screen)
- (0:00) "Your phone is already a computer that's on all the time. Why rent a server to run an agent?"
- (0:04) "phone-agent runs a Pi coding agent entirely inside a Chrome tab on an Android phone —
  the agent loop, a bash shell, a filesystem, even Python — nothing installed on the phone."
- (0:09) "Here it's launching from scratch: it joins my tailnet with its own identity, restores
  its files and transcript, and attests the Tinfoil inference enclave. Two seconds."

## 0:12–0:52 · side by side (left: laptop chat UI · right: the phone's log, same session, sped up)
- (0:12) "The tab is a real Tailscale node. The page on the left is served *by the phone* to my laptop
  over the tailnet — no relay, no cloud."
- (0:18) "I ask what we did earlier. It remembers: the transcript lives in the browser's storage and
  survives restarts."
- (0:26) "Every reply comes from DeepSeek on Tinfoil, through an attested, encrypted channel —
  the phone verified the enclave before sending a token."
- (0:34) "Now the fun part: 'show your golfed Fibonacci code and run it again.'"
- (0:40) "The agent calls its python tool. That's CPython in WebAssembly, in a sandboxed worker,
  sharing the agent's files — the runtime loaded in two seconds."
- (0:47) "Output streams back to the laptop over server-sent events. The phone did all of it."

## 0:52–1:00 · end card
- (0:52) "Pi, Tailscale and Pyodide — in one tab, on a phone, controlled from anywhere on the tailnet.
  phone-agent."

## Notes for recording
- Total spoken text ≈ 150 words ≈ 60 s at a relaxed pace. Trim the 0:26 line if running long.
- Nothing in the footage is secret, but the phone log shows a tailnet node name/IP — fine for a demo video,
  redact in the repo.
