# 60-second demo — voiceover script

Timecodes match `demo.mp4` (silent) and `demo.srt`. Read at a calm pace; each line is ~3–4 s.

## 0:00–0:12 · intro (phone: launching the app from the home screen)
- (00:00) "Your phone is an always-on computer. Why rent a server?"
- (00:04) "phone-agent runs a Pi agent inside a Chrome tab on a phone."
- (00:09) "Launched from scratch: on the tailnet in two seconds."

## 0:12–0:52 · side by side (left: laptop chat UI · right: the phone's log, same session, 1.8x)
- (00:12) "The tab is a real Tailscale node, serving this chat page to my laptop."
- (00:18) "I ask what we did earlier. It remembers: the transcript lives in browser storage and survives restarts."
- (00:26) "Every reply comes from DeepSeek on Tinfoil, over an attested, encrypted channel the phone verified itself."
- (00:34) "Now: show your golfed Fibonacci code, and run it again."
- (00:40) "The python tool is CPython in WebAssembly, sandboxed in a worker, sharing the agent's files."
- (00:47) "Output streams back to the laptop. The phone did all of it."

## 0:52–1:00 · end card
- (00:52) "Pi, Tailscale and Pyodide in one tab, on a phone, controlled from anywhere on the tailnet. phone-agent."

## Notes for recording
- ~110 words; Piper TTS (demo/voiceover.sh) fits each line inside its subtitle slot at 0.95 length scale.
- Nothing in the footage is secret, but the phone log shows a tailnet node name/IP — fine for a demo video,
  redact in the repo.
