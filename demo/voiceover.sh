#!/usr/bin/env bash
# Synthesize the voiceover from demo.srt with Piper TTS (voice: demo/voice/*.onnx), place each cue at its start time,
# and mux into demo-vo.mp4 / demo-vo-subs.mp4. Requires nix (piper-tts) and ffmpeg.
# Env: VOICE (onnx path), LENGTH_SCALE (1.0 = normal; <1 faster), GAP (min silence between cues, s)
set -euo pipefail
cd "$(dirname "$0")"
VOICE="${VOICE:-$(ls voice/*.onnx | head -1)}"; LENGTH_SCALE="${LENGTH_SCALE:-0.95}"; GAP="${GAP:-0.35}"
W=vo; rm -rf $W; mkdir -p $W
# 1) cues -> cueN.txt + start times
node - <<'JS'
const fs=require("fs");const srt=fs.readFileSync("demo.srt","utf8").trim().split(/\n\s*\n/);
const cues=srt.map(b=>{const l=b.split("\n");const [s]=l[1].split(" --> ");const t=l.slice(2).join(" ").replace(/\s+/g," ").trim();
 const [h,m,rest]=s.split(":");const sec=+h*3600+ +m*60+parseFloat(rest.replace(",","."));return {start:sec,text:t}});
fs.writeFileSync("vo/cues.json",JSON.stringify(cues));cues.forEach((c,i)=>fs.writeFileSync(`vo/cue${i}.txt`,c.text+"\n"));
console.log(cues.length,"cues");
JS
# 2) synthesize
n=$(node -p "require('./vo/cues.json').length")
# one nix shell for all cues (nix startup dominates otherwise)
nix shell nixpkgs#piper-tts --command bash -c "for i in \$(seq 0 $((n-1))); do piper --model '$VOICE' --length_scale $LENGTH_SCALE --sentence_silence 0.15 --output_file $W/cue\$i.wav < $W/cue\$i.txt >/dev/null 2>&1; done"
for i in $(seq 0 $((n-1))); do d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/cue$i.wav"); echo "cue $i: ${d}s  $(head -c 60 $W/cue$i.txt)"; done
# 3) timeline: start at cue time, but never before the previous cue ended (+GAP); report drift
node - "$GAP" <<'JS'
const fs=require("fs");const {execSync}=require("child_process");const gap=+process.argv[2];
const cues=JSON.parse(fs.readFileSync("vo/cues.json"));let prevEnd=0,inputs=[],filters=[],drift=0;
cues.forEach((c,i)=>{const d=+execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 vo/cue${i}.wav`).toString();
 const at=Math.max(c.start,prevEnd+gap);drift=Math.max(drift,at-c.start);prevEnd=at+d;
 inputs.push(`-i vo/cue${i}.wav`);filters.push(`[${i}:a]adelay=${Math.round(at*1000)}|${Math.round(at*1000)}[a${i}]`);
 console.log(`cue ${i}: planned ${c.start.toFixed(1)}s -> placed ${at.toFixed(2)}s, ends ${prevEnd.toFixed(2)}s`);});
console.log(`max shift vs subtitles: ${drift.toFixed(2)}s; speech ends at ${prevEnd.toFixed(2)}s (video is 60s)`);
const mix=`${filters.join(";")};${cues.map((_,i)=>`[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
fs.writeFileSync("vo/ffargs.txt",`${inputs.join(" ")} -filter_complex "${mix}" -map [out] -t 60 -ar 48000 -ac 2 voiceover.wav`);
JS
eval ffmpeg -hide_banner -loglevel error -y $(cat $W/ffargs.txt)
# 4) mux (video unchanged)
ffmpeg -hide_banner -loglevel error -y -i demo.mp4 -i voiceover.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest demo-vo.mp4
ffmpeg -hide_banner -loglevel error -y -i demo-subs.mp4 -i voiceover.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest demo-vo-subs.mp4
ls -la voiceover.wav demo-vo.mp4 demo-vo-subs.mp4
