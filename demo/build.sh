#!/usr/bin/env bash
# Build demo.mp4 (60 s, 1920x1080, silent) from the three screen captures + burn demo.srt into demo-subs.mp4.
# Layout: 0–12 s intro (phone launch, real time) · 12–52 s laptop UI + phone log side by side, synced, 1.8x ·
# 52–60 s end card. Edit intro.txt / outro.txt / demo.srt and re-run.
set -euo pipefail
cd "$(dirname "$0")"
C=../screencaps
OPEN="$C/screen-phone-agent-open-20261107-165640-1794088588749.mp4"
LAP="$C/localhost_demo-chrome-desktop-2026-11-07_16.42.24.mkv"
PH="$C/screen-long-full-agent-flow-20261107-164407-1794087728538.mp4"
F=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
SPEED=1.8; OFF=16; MAIN_START=12; MAIN_LEN=40; LAP_LEN=$(awk "BEGIN{print $MAIN_LEN*$SPEED}")   # 72 s of source
ffmpeg -hide_banner -loglevel error -y \
  -i "$OPEN" -i "$LAP" -i "$PH" \
  -filter_complex "
    color=c=0x0e0f12:s=1920x1080:r=30:d=60[bg];
    [0:v]trim=2.2:12,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,scale=-2:880,format=yuva420p[open];
    [1:v]trim=0:$LAP_LEN,setpts=(PTS-STARTPTS)/$SPEED+$MAIN_START/TB,scale=-2:880,format=yuva420p[lap];
    [2:v]trim=$OFF:$(awk "BEGIN{print $OFF+$LAP_LEN}"),setpts=(PTS-STARTPTS)/$SPEED+$MAIN_START/TB,scale=-2:880,format=yuva420p[ph];
    [bg][open]overlay=x=1300:y=60:eof_action=pass:enable='lt(t,12)'[v1];
    [v1][lap]overlay=x=370:y=70:eof_action=pass:enable='between(t,12,52)'[v2];
    [v2][ph]overlay=x=1153:y=70:eof_action=pass:enable='between(t,12,52)'[v3];
    [v3]drawtext=fontfile=$FB:textfile=intro.txt:fontsize=40:fontcolor=0xe6e6e6:line_spacing=14:x=120:y=130:enable='lt(t,12)',
        drawtext=fontfile=$F:text='laptop — chat UI served by the phone (1.8x)':fontsize=28:fontcolor=0x99aaaa:x=370:y=30:enable='between(t,12,52)',
        drawtext=fontfile=$F:text='phone — its own log (1.8x)':fontsize=28:fontcolor=0x99aaaa:x=1153:y=30:enable='between(t,12,52)',
        drawtext=fontfile=$FB:textfile=outro.txt:fontsize=52:fontcolor=0xe6e6e6:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2:enable='gte(t,52)',
        fade=t=in:st=0:d=0.5,fade=t=out:st=59.3:d=0.7,format=yuv420p[out]" \
  -map "[out]" -t 60 -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart demo.mp4
# burned-in subtitles variant
ffmpeg -hide_banner -loglevel error -y -i demo.mp4 -vf "subtitles=demo.srt:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&HA0000000,Outline=1,MarginV=8'" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart demo-subs.mp4
ls -la demo.mp4 demo-subs.mp4
