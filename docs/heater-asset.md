# 온풍기 본체 이미지

- 파일: `public/heater0.png`
- 생성: 2026-09-05, 내장 ImageGen 도구 (CLI/API 대체 경로 사용 안 함)
- 규격: 1672 × 941, 알파 채널을 가진 PNG, 약 562 KiB
- 생성 원본을 그대로 복사했다. 배경은 실제 투명이며 본체 중앙은 온도 텍스트를 위해 비웠다.
- 본체에 고정 루버가 포함되어 있다. 전용 보조 팬이 없는 경우 에어컨 팬은 숨기고,
  공통 바람 그래픽에는 CSS로 따뜻한 색을 입힌다.
- 외부 이미지 호스트나 새 스크립트 권한 없이 기존 정적 파일 경로와 CSP로 제공한다.

## 생성 프롬프트

```text
Use case: product-mockup. Asset type: transparent PNG body sprite for an existing online air-conditioner/heater web app. Create ONE elegant wall-mounted electric fan heater, straight front view with a slight view of the underside, ivory white gently rounded rectangular housing, subtle warm copper trim and a dark lower horizontal grille containing a restrained amber ceramic heating glow. Clear blank white upper central face for an HTML live temperature overlay; absolutely NO text, numbers, logos, symbols, watermark or fake digital display. Clean realistic soft 3D product illustration. Landscape 16:9 canvas, 1536x864 pixels if possible. EXACT FRAMING: heater occupies only x=16% through84% and y=28% through65% of canvas, with genuinely transparent empty padding all around, especially below; body aspect ratio about3.2:1. Keep edges crisp for display at350px canvas width. The background must be true alpha transparency, no checkerboard painted in, no floor, no cast shadow outside the object, no environment, no heat rays outside the body. The entire lower vent and its fixed louvers must be built into this one body sprite; do not add separate floating pieces. Friendly clean appliance suitable on both white and dark UI backgrounds.
```

출력 규격과 실제 본체 여백은 생성 요청과 차이가 있으므로, 위 규격은 출력 PNG를
읽어 확인한 값이다. 온도 텍스트와의 배치는 앱에서 확인한다.
