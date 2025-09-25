/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() private currentStage = 0;
  @state() private isLoggedIn = false;
  @state() private userName = '';
  @state() private language = 'en-US';

  private stages = [
    'Greeting',
    'Payment Process',
    'NBFCs',
    'RCA & KYC Docs',
  ];

  private client: GoogleGenAI;
  private session: Session;
  // FIX: Cast window to `any` to access vendor-prefixed `webkitAudioContext` without TypeScript errors.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      font-family: sans-serif;
    }

    .stepper {
      position: absolute;
      top: 5vh;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      width: 90%;
      max-width: 800px;
      z-index: 10;
      color: white;
      font-family: sans-serif;
    }
    .step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      width: 100px;
      text-align: center;
      opacity: 0.5;
      transition: opacity 0.3s ease;
    }
    .step.active,
    .step.completed {
      opacity: 1;
    }
    .step-number {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      transition: all 0.3s ease;
    }
    .step.active .step-number {
      background-color: white;
      color: #100c14; /* background color */
      transform: scale(1.1);
    }
    .step.completed .step-number {
      background-color: #4caf50;
      border-color: #4caf50;
      color: white;
    }
    .step-name {
      font-size: 13px;
      font-weight: 500;
    }
    .step-connector {
      flex: 1;
      height: 2px;
      background: white;
      margin-top: 16px;
      opacity: 0.5;
      transition: all 0.3s ease;
    }
    .step-connector.completed {
      background: #4caf50;
      opacity: 1;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      #startButton[disabled],
      #stopButton[disabled] {
        display: none;
      }
      #resetButton[disabled],
      #nextStageButton[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #resetButton[disabled]:hover,
      #nextStageButton[disabled]:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      #nextStageButton {
        width: auto;
        padding: 0 24px;
        height: 48px;
        font-size: 16px;
      }
    }

    #login-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 20;
      background: rgba(20, 16, 26, 0.7);
      padding: 40px;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: white;
      font-family: sans-serif;
      width: 90%;
      max-width: 400px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      text-align: center;
    }
    #login-container h2 {
      margin-top: 0;
      margin-bottom: 8px;
      font-size: 28px;
    }
    #login-container p {
      margin-top: 0;
      margin-bottom: 24px;
      opacity: 0.8;
    }
    .form-group {
      margin-bottom: 20px;
      text-align: left;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .form-group input,
    .form-group select {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 16px;
      box-sizing: border-box; /* Important for padding */
    }
    .form-group select {
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 1em;
      padding-right: 2.5em; /* Make space for arrow */
    }
    .form-group option {
      background: #100c14; /* Match background color */
      color: white;
    }
    #login-container button {
      width: 100%;
      padding: 14px;
      font-size: 18px;
      font-weight: bold;
      color: #100c14;
      background: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.3s ease;
    }
    #login-container button:hover {
      background: #dddddd;
    }
  `;

  constructor() {
    super();
    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    this.initAudio();
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
            languageCode: this.language,
          },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');

      if (this.currentStage === 0) {
        setTimeout(() => {
          if (this.isRecording && this.currentStage === 0) {
            this.nextStage();
          }
        }, 60000);
      }
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private nextStage() {
    if (this.currentStage < this.stages.length - 1) {
      this.currentStage += 1;
    }
  }

  private reset() {
    this.stopRecording();
    this.session?.close();
    this.initSession();
    this.currentStage = 0;
    this.updateStatus('Session cleared.');
  }

  private handleLogin(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    this.userName = formData.get('name') as string;
    this.language = formData.get('language') as string;
    this.isLoggedIn = true;
    this.initSession();
  }

  private renderLogin() {
    return html`
      <div id="login-container">
        <form @submit=${this.handleLogin}>
          <h2>Welcome</h2>
          <p>Please enter your name and select your preferred language.</p>
          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" required />
          </div>
          <div class="form-group">
            <label for="language">Language</label>
            <select
              id="language"
              name="language"
              .value=${this.language}
              @change=${(e: Event) =>
                (this.language = (e.target as HTMLSelectElement).value)}>
              <option value="en-US">English</option>
              <option value="hi-IN">Hindi</option>
              <option value="te-IN">Telugu</option>
            </select>
          </div>
          <button type="submit">Start Conversation</button>
        </form>
      </div>
    `;
  }

  private renderApp() {
    return html`
      <div class="stepper">
        ${this.stages.map(
          (stage, i) => html`
            <div
              class="step ${i === this.currentStage ? 'active' : ''} ${i <
              this.currentStage
                ? 'completed'
                : ''}">
              <div class="step-number">
                ${i < this.currentStage ? '✓' : i + 1}
              </div>
              <div class="step-name">${stage}</div>
            </div>
            ${i < this.stages.length - 1
              ? html`<div
                  class="step-connector ${i < this.currentStage
                    ? 'completed'
                    : ''}"></div>`
              : ''}
          `,
        )}
      </div>
      <div class="controls">
        <button
          id="resetButton"
          @click=${this.reset}
          ?disabled=${this.isRecording}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="40px"
            viewBox="0 -960 960 960"
            width="40px"
            fill="#ffffff">
            <path
              d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
          </svg>
        </button>
        <button
          id="startButton"
          @click=${this.startRecording}
          ?disabled=${this.isRecording}>
          <svg
            viewBox="0 0 100 100"
            width="32px"
            height="32px"
            fill="#c80000"
            xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" />
          </svg>
        </button>
        <button
          id="stopButton"
          @click=${this.stopRecording}
          ?disabled=${!this.isRecording}>
          <svg
            viewBox="0 0 100 100"
            width="32px"
            height="32px"
            fill="#000000"
            xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="100" height="100" rx="15" />
          </svg>
        </button>
        <button
          id="nextStageButton"
          @click=${this.nextStage}
          ?disabled=${!this.isRecording ||
          this.currentStage >= this.stages.length - 1}>
          Next Stage
        </button>
      </div>

      <div id="status">${this.error || this.status}</div>
    `;
  }

  render() {
    return html`
      <div>
        ${this.isLoggedIn ? this.renderApp() : this.renderLogin()}
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
