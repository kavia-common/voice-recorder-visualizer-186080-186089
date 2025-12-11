#!/bin/bash
cd /home/kavia/workspace/code-generation/voice-recorder-visualizer-186080-186089/voice_recorder_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

