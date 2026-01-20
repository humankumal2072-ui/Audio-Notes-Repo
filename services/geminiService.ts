
import { GoogleGenAI, Type, Modality } from "@google/genai";

export interface TranscribeResponse {
  transcription: string;
  summary: string;
  actionItems: string[];
  suggestedTitle: string;
  tags: string[];
}

export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<TranscribeResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          {
            text: "Analyze this audio. Provide: 1. A full accurate transcription. 2. A concise 1-sentence summary. 3. A list of specific action items or tasks mentioned. 4. A short punchy title. 5. Up to 3 relevant one-word tags/categories (e.g., Work, Personal, Meeting, Idea).",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcription: { type: Type.STRING },
            summary: { type: Type.STRING },
            actionItems: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            suggestedTitle: { type: Type.STRING },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Short one-word categories for the content"
            }
          },
          required: ["transcription", "summary", "actionItems", "suggestedTitle", "tags"]
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No response from Gemini");
    return JSON.parse(jsonStr) as TranscribeResponse;
  } catch (error) {
    console.error("Transcription error:", error);
    throw new Error("Failed to process audio. Please try again.");
  }
}

export async function reTitleNote(transcription: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a short, creative, and professional title for the following audio transcription. Return ONLY the title text, nothing else:\n\n${transcription}`,
    });
    return response.text?.trim() || "Untitled Note";
  } catch (error) {
    console.error("Retitle error:", error);
    return "Untitled Note";
  }
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate the following text into ${targetLanguage}. Return ONLY the translated text, nothing else. Maintain the tone of the original content:\n\n${text}`,
    });
    return response.text?.trim() || "";
  } catch (error) {
    console.error("Translation error:", error);
    throw new Error("Failed to translate text.");
  }
}

export async function generateSpeech(text: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Read the following clearly and naturally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data returned from Gemini TTS");
    return base64Audio;
  } catch (error) {
    console.error("TTS error:", error);
    throw new Error("Failed to generate speech.");
  }
}
