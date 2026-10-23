import { Tool } from "./types.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const voiceInputTool: Tool = {
  name: "voice_input",
  description:
    "Voice input: speech-to-text for prompts, voice commands, and audio transcription. " +
    "Supports Whisper (local) and cloud providers.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["transcribe", "record", "status", "languages"],
        description: "What to do",
      },
      audioPath: { type: "string", description: "Path to audio file to transcribe" },
      language: { type: "string", description: "Language code (e.g. 'en', 'es', 'fr')" },
      model: { type: "string", description: "Whisper model size (tiny, base, small, medium, large)" },
    },
    required: ["action"],
  },
  async execute(args, _ctx) {
    const cwd = _ctx.cwd;
    const action = String(args.action || "status");

    switch (action) {
      case "status": {
        const lines = ["## Voice Input Status", ""];
        // Check for whisper
        try {
          const r = await exec("whisper", ["--version"]);
          lines.push(`  Whisper: ${r.stdout.trim() || "installed"}`);
        } catch {
          try {
            const r = await exec("whisper-cpp", ["--version"]);
            lines.push(`  Whisper.cpp: ${r.stdout.trim() || "installed"}`);
          } catch {
            lines.push("  Whisper: not installed");
            lines.push("  Install: pip install openai-whisper  (or brew install whisper-cpp)");
          }
        }
        // Check for ffmpeg
        try {
          await exec("ffmpeg", ["-version"]);
          lines.push("  FFmpeg: available");
        } catch {
          lines.push("  FFmpeg: not available (needed for audio processing)");
        }
        // Check for sox
        try {
          await exec("sox", ["--version"]);
          lines.push("  SoX: available (recording)");
        } catch {
          lines.push("  SoX: not available (needed for recording)");
        }
        return lines.join("\n");
      }

      case "transcribe": {
        if (!args.audioPath) return "Error: audioPath required";
        const audioPath = resolve(cwd, args.audioPath);
        const model = args.model || "base";
        const lang = args.language || "en";
        try {
          const r = await exec("whisper", [audioPath, "--model", model, "--language", lang, "--output_format", "txt"], { timeout: 300_000 });
          // Read the output file
          const outPath = audioPath.replace(/\.[^.]+$/, ".txt");
          if (existsSync(outPath)) {
            const text = readFileSync(outPath, "utf8");
            return `Transcription:\n\n${text}`;
          }
          return r.stdout.trim() || "Transcription complete (check output file)";
        } catch (e: any) {
          // Try whisper-cpp
          try {
            const r = await exec("whisper-cpp", ["-m", `models/ggml-${model}.bin`, "-f", audioPath, "-l", lang]);
            return `Transcription:\n\n${r.stdout.trim()}`;
          } catch {
            return `Error: ${e.message}\n\nInstall Whisper: pip install openai-whisper`;
          }
        }
      }

      case "record": {
        const outPath = join(cwd, `recording-${Date.now()}.wav`);
        try {
          // Record 5 seconds using sox
          await exec("sox", ["-d", "-r", "16000", "-c", "1", outPath, "trim", "0", "5"], { timeout: 10_000 });
          return `Recording saved to ${outPath}\nTranscribe with: voice_input(action="transcribe", audioPath="${outPath}")`;
        } catch (e: any) {
          return `Error recording: ${e.message}\n\nInstall SoX: sudo apt install sox`;
        }
      }

      case "languages": {
        return `Supported languages (Whisper):\n  en, es, fr, de, it, pt, ru, ja, ko, zh, ar, hi, nl, pl, tr, vi, th, id, ms, tl, ... (99 languages total)`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};
