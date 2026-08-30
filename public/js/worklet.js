/**
 * 브라운 노이즈 생성기 (AudioWorkletGlobalScope에서 실행된다).
 *
 * 흰 잡음을 누설 적분기(leaky integrator)에 통과시켜 저역이 강조된
 * 브라운 노이즈를 만든다.
 */
class BrownNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lastOut = 0.0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      const outputChannel = output[channel];
      for (let i = 0; i < outputChannel.length; i++) {
        const white = Math.random() * 2 - 1;
        outputChannel[i] = (this.lastOut + 0.03 * white) / 1.02;
        this.lastOut = outputChannel[i];
        outputChannel[i] *= 3.5;
      }
    }
    return true;
  }
}

registerProcessor("brown-noise-processor", BrownNoiseProcessor);
