# Idea Gardening System — 기술 설계 문서

## 시스템 개요

Slack 채널에 매일 아침 9개의 사고 자극 질문을 던지고, 사용자가 골라서 스레드에 답하면 context-aware Socratic interview로 사고를 심화시키며, 완료된 대화를 구조화된 수확물로 저장하는 사고 수확 파이프라인.

---

## 핵심 설계 원칙

이 시스템의 레버리지는 "글을 잘 쓰는 것"이 아니라 **"쓸 거리를 일상에서 끊임없이 수확하는 것"**이다. 이를 위해 두 축의 균형이 필요하다:

- **Hooked (습관 유지)**: 9개 중 끌리는 것만 골라 답하는 가벼움, 모바일에서 스레드 reply
- **Rich (사고 확장)**: 맥락을 반영한 날카로운 질문, 깊어지는 스레드 대화

---

## 기술 스택

| 구성 요소 | 선택 | 이유 |
|-----------|------|------|
| Runtime | Node.js | 사용자 주력 스택, Slack SDK 생태계 |
| Slack SDK | `@slack/bolt` | 이벤트 기반 Slack bot, Socket Mode |
| LLM Client | `openai` npm 패키지 | DeepSeek의 OpenAI-compatible API 사용 |
| Scheduler | `node-cron` | 경량 cron |
| Storage | 로컬 파일시스템, Markdown + YAML frontmatter | 이식성, Git 호환, ripgrep 검색 |
| Infra | VPS + pm2 | 24시간 가동 |

### LLM 모델

| 모델 | 용도 | Input/Output (per 1M tokens) |
|------|------|------------------------------|
| DeepSeek V3.2 | MVP 기본 모델 | $0.28 / $0.42 |

- 예상 월 비용: $1-3
- 예산 상한: 월 $10
- Claude 전환 기능은 Phase 3 이후 검토

---

## Slack 인터랙션 모델

### 채널 기반 질문-응답

모든 인터랙션은 지정된 Slack 채널 (예: `#interview`)에서 이루어진다.

### 하루 흐름

```
매일 KST 9:00 AM
  │
  ├─ 전날 대화 + context layers를 반영하여
  ├─ 3개 모드 × 3개 = 총 9개 질문 생성
  └─ #interview 채널에 9개 메시지 발송
       │
       🌱 [Harvest] 질문 1
       🌱 [Harvest] 질문 2
       🌱 [Harvest] 질문 3
       💎 [Crig] 질문 4
       💎 [Crig] 질문 5
       💎 [Crig] 질문 6
       🔀 [Bisociate] 질문 7
       🔀 [Bisociate] 질문 8
       🔀 [Bisociate] 질문 9
       │
       사용자: 끌리는 질문에만 스레드로 reply
       │
       봇: 해당 스레드에서 follow-up 질문 (모드별 세션 arc)
       │
       사용자: "done" → 수확물로 저장
```

### 스레드 기반 세션

- **세션 = 스레드**. 하나의 질문 메시지 아래 스레드가 하나의 세션.
- **세션 키 = `thread_ts`** (Slack 스레드 타임스탬프)
- **모드 자동 결정**: 부모 메시지의 이모지/라벨로 모드를 식별 (🌱→Harvest, 💎→Crig, 🔀→Bisociate)
- **복수 세션 동시 가능**: 여러 질문에 동시에 스레드를 열 수 있음
- **선택적 참여**: 9개 중 0개에 답해도 되고, 9개 모두 답해도 됨

### 1개 봇, 시각적 모드 구분

하나의 Slack App이 모드별로 다른 이모지+라벨을 붙여 메시지를 보낸다.

```
🌱 [Harvest] 오늘 뭔가 흥미로운 걸 읽거나 들은 게 있어?

💎 [Crig] "습관 루프"라는 개념 — 지금 어느 정도 이해하고 있어?

🔀 [Bisociate] 프로그래밍의 디버깅과 글쓰기의 편집 — 공통점이 있을까?
```

---

## 인터뷰 모드 시스템

Socratic interview는 단일 방식이 아니라, 상황에 맞는 **모드**로 접근한다. 각 모드는 고유한 세션 arc와 질문 전략을 갖는다.

### 모드 개요

| 모드 | 이모지 | 목적 | 시작 질문 스타일 |
|------|--------|------|-----------------|
| **Harvest** | 🌱 | 일상의 생각을 꺼내고 글감으로 발전시킴 | 가볍고 열린 질문 |
| **Crig** | 💎 | 하나의 개념의 골격을 세우고 결정화 | 특정 개념에 대한 이해도 질문 |
| **Bisociate** | 🔀 | 서로 다른 두 개념의 교차점을 발견 | 두 도메인을 충돌시키는 질문 |

---

### 모드 1: Harvest (기본)

일상의 생각을 꺼내고, 깊이를 더하고, 글감으로 결정화하는 기본 모드.

**시작 질문 (채널에 포스트):**
가볍고 열린 Spark 질문. 답하고 싶은 충동이 드는 수준.

**스레드 세션 Arc:**

```
[첫 reply] Dig → Connect → Crystallize
```

| 단계 | 목적 | 턴 수 | 질문 예시 |
|------|------|-------|-----------|
| **Dig** | 왜, 어떻게를 파고듦 | 2-3 | "그게 왜 의외였어?", "네 경험에서 비슷한 사례가 있어?" |
| **Connect** | 과거 생각/외부 지식과 연결 | 1-2 | "지난주에 비슷한 얘기 했는데, 연결되는 게 있을까?" |
| **Crystallize** | 핵심 인사이트 한 문장 정리 | 1 | "지금까지 얘기를 한 문장으로 정리하면?" |

시작 질문이 이미 Spark 역할이므로, 스레드에서는 Dig부터 시작한다.

---

### 모드 2: Crig (Crystal Rigging)

하나의 개념의 골격을 세워 머릿속에서 돌릴 수 있게 하고, 씨앗으로 결정화하는 모드.

**시작 질문 (채널에 포스트):**
특정 개념에 대한 현재 이해도를 묻는 질문. 과거 수확물에서 아직 결정화되지 않은 개념을 선택.

**스레드 세션 Arc:**

```
[첫 reply] Friction 감지 → 리깅 루프 → 결정화 → 완료 테스트
```

| 단계 | 목적 | 질문 전략 |
|------|------|-----------|
| **Friction 감지** | 골격이 안 서는 지점 식별 | 발화 패턴에서 friction 유형 분류 |
| **리깅** | friction 해소를 반복하여 골격 완성 | friction 유형별 조작 수행 |
| **결정화** | 골격을 씨앗 문장으로 압축 | "한 문장으로 굳혀보자" |
| **완료 테스트** | 씨앗에서 구조가 복원되는지 확인 | 확장, 반사실, 변수 조작 |

**Friction 유형과 조작:**

| 발화 패턴 | Friction | 조작 |
|-----------|----------|------|
| "그려지지 않아", "감이 안 와" | 공허 | 비유, 예시, 도식 |
| "어떻게 연결돼?", "관계가 뭐야?" | 단절 | 요소 간 관계 명시 |
| "흩어진 느낌" | 산발 | 연역적 재구성 |
| "왜 필요해?", "없으면?" | 무의미 | 반사실 탐색 |
| "이게 맞아?", "실제로는?" | 불안 | 외부 출처 대조 |
| "근데 ~아니야?", "모순 아냐?" | 위화감 | 모순 지점 수정 |
| "즉 ~라는 거지?" | 타자성 | 자기 언어화 지원 |

**완료 체크리스트:**
- 압축: "한 문장으로" → 씨앗 도출
- 확장: "연역적으로 풀어봐" → 구조 복원
- 반사실: "X가 없다면?" → 결과 예측
- 변수 조작: "X를 늘리면/줄이면?" → 결과 예측

---

### 모드 3: Bisociate

서로 무관한 두 개념의 교차점을 찾아 새로운 인사이트를 발견하는 모드.

**시작 질문 (채널에 포스트):**
과거 수확물에서 서로 다른 도메인의 태그 2개를 골라 충돌시키는 질문.
- 예: `[습관-설계]` + `[프로그래밍]` → "습관을 만드는 것과 코드를 짜는 것의 공통점이 뭘까?"

**스레드 세션 Arc:**

```
[첫 reply] 구조 추출 → 교차 탐색 → 공유 논리 → 결정화
```

| 단계 | 목적 | 질문 예시 |
|------|------|-----------|
| **구조 추출** | 각 개념의 핵심 메커니즘 파악 | "A의 핵심 원리가 뭐야?", "B는 어떻게 작동해?" |
| **교차 탐색** | 둘 사이 숨겨진 유사성/대비 탐색 | "A에서 작동하는 원리가 B에도 적용될까?" |
| **공유 논리** | 교차점에서 더 깊은 패턴 발견 | "둘 다 결국 같은 문제를 다른 방식으로 풀고 있는 건 아닐까?" |
| **결정화** | 발견을 한 줄 인사이트로 압축 | "이 교차점이 시사하는 바를 한 문장으로 하면?" |

시작 질문이 이미 두 개념을 표면화하므로, 스레드에서는 구조 추출부터 시작한다.

---

## 맥락 시스템 (Context Layers)

질문의 품질은 맥락의 깊이에 비례한다. 두 곳에서 context가 사용된다:

### 1. 매일 아침 질문 생성 시

```
질문 생성 Prompt:
  ├─ Layer 0: 역할 정의 + 모드별 시작 질문 가이드
  ├─ Layer 1: 사용자 프로필 (identity/profile.md)
  ├─ Layer 2: 테마 요약 (themes.md)
  ├─ Layer 3: 최근 수확물들의 seed + tags
  └─ 전날 대화 요약 (어떤 질문에 답했고, 어떤 인사이트가 나왔는지)
```

이를 통해 **"전날 대화를 반영한 9개 질문"**이 생성된다.

### 2. 스레드 내 follow-up 시

```
Follow-up Prompt:
  ├─ Layer 0: 역할 정의 + 현재 모드의 세션 arc
  ├─ Layer 3: 관련 수확물 (태그 기반 선택)
  └─ Layer 4: 현재 스레드 history
```

### Phase별 context 진화

| Phase | Layer 0 | Layer 1 | Layer 2 | Layer 3 | 전날 반영 |
|-------|---------|---------|---------|---------|-----------|
| Phase 1 | ✅ 모드별 prompt | ❌ | ❌ | ❌ | ✅ 기본 |
| Phase 2 | ✅ | ✅ 수동 작성 | ❌ | ✅ 최근 N개 seed | ✅ |
| Phase 3 | ✅ | ✅ | ✅ 자동 갱신 | ✅ 태그 기반 검색 | ✅ |

### themes.md (Phase 3)

매일 자정, 전체 수확물을 LLM에 넣고 아래를 갱신:

```markdown
## 반복 주제
- AI 글쓰기: 7회 언급, 최근 3일 내 활발
- 습관 설계: 5회, 지난주 이후 침묵

## 발전 중인 아이디어
- "글쓰기의 병목은 writing이 아니라 thinking" — 3개 harvest에서 반복, 아직 구조화 안 됨

## 빈 공간 (아직 얕은 주제)
- 독자 관점에서의 가치 — 1회만 언급, 더 파볼 여지
```

---

## 세션 관리

**세션 = Slack 스레드**. `thread_ts`가 세션의 고유 키.

```javascript
// 세션 구조
{
  threadTs: '1710400000.000100',   // Slack 스레드 타임스탬프 = 세션 키
  channelId: 'C0123INTERVIEW',
  mode: 'harvest',                  // 부모 메시지의 이모지에서 결정
  phase: 'dig',                     // 세션 arc 내 현재 단계
  history: [
    { role: 'assistant', content: '...' },
    { role: 'user', content: '...' }
  ],
  startedAt: Date.now()
}
```

- 사용자가 스레드에 reply할 때마다 `ops/sessions/{threadTs}.json`에 저장
- "done" 메시지 → seed/tags 추출 → harvest로 변환 → 세션 파일 삭제
- 서버 재시작 시 active 세션 파일이 있으면 복구
- 자정에 미완료 세션 자동 저장 (다음날 새 질문이 올라오므로)

---

## 수확물 저장

### Frontmatter Schema

```yaml
---
id: h-20260314-001
date: 2026-03-14
mode: harvest | crig | bisociate
seed: "AI 글쓰기의 진짜 병목은 writing이 아니라 thinking이다"
tags: [ai-writing, creative-process]
connections: [h-20260310-002]
---
```

| 필드 | 생성 방식 | Phase |
|------|-----------|-------|
| `id` | 자동 (날짜 + 순번) | 1 |
| `date` | 자동 | 1 |
| `mode` | 세션의 인터뷰 모드 | 1 |
| `seed` | 대화 종료 시 LLM이 추출 | 1 |
| `tags` | 대화 종료 시 LLM이 내용 기반 생성 | 1 |
| `connections` | 대화 종료 시 LLM이 context 내 관련 harvest 추론 | 2 |

### 본문 포맷

```markdown
---
id: h-20260314-001
date: 2026-03-14
mode: harvest
seed: "AI 글쓰기의 진짜 병목은 writing이 아니라 thinking이다"
tags: [ai-writing, creative-process]
connections: []
---

Q: 오늘 읽은 글에서 가장 의외였던 부분이 뭐야?

A: AI가 인간 글을 못 따라하는 이유가 stop words 같은
무의식적 패턴 때문이라는 게 의외였어.

Q: 그게 네 LinkedIn 글쓰기에 어떤 시사점을 줘?

A: AI한테 글을 써달라고 하기보다, 내 생각을
먼저 수확하고 그걸 바탕으로 쓰는 게 맞겠다 싶어.
```

---

## 대화 흐름

### 매일 아침 질문 생성

```
node-cron ('0 9 * * *', { timezone: 'Asia/Seoul' })
  │
  ├─ context layers 조합 (전날 대화 + 기존 수확물)
  ├─ LLM에 9개 질문 생성 요청 (모드당 3개)
  └─ #interview 채널에 9개 메시지 순차 발송
       ├─ 🌱 [Harvest] 질문 1
       ├─ 🌱 [Harvest] 질문 2
       ├─ 🌱 [Harvest] 질문 3
       ├─ 💎 [Crig] 질문 4
       ├─ 💎 [Crig] 질문 5
       ├─ 💎 [Crig] 질문 6
       ├─ 🔀 [Bisociate] 질문 7
       ├─ 🔀 [Bisociate] 질문 8
       └─ 🔀 [Bisociate] 질문 9
```

### 스레드 대화

```
사용자가 질문 메시지에 스레드 reply
  │
  ├─ 부모 메시지에서 모드 식별 (🌱/💎/🔀)
  ├─ 새 세션 생성 (thread_ts 기반)
  ├─ 모드별 세션 arc에 따라 follow-up 질문 생성
  ├─ 스레드에 reply로 전송
  ├─ 세션 디스크에 백업
  └─ 반복
       │
       ├─ "done" → seed/tags 추출 → harvest 저장 → 세션 종료
       └─ 자정 → 미완료 세션 자동 저장
```

---

## Slack Commands

| 명령어 | 동작 |
|--------|------|
| `done` (스레드 내 메시지) | 현재 스레드 대화를 마치고 harvest 저장 |

모드 선택은 슬래시 명령이 아니라 **질문에 reply하는 행위**로 결정된다.

---

## 파일 구조

```
thought-harvest/
├── src/
│   ├── bot.js              # Slack bolt 앱, 이벤트 핸들링
│   ├── llm.js              # LLM 클라이언트, context layer 조합, 모델 호출
│   ├── session.js           # 세션 생명주기 (스레드 기반), 디스크 백업/복구
│   └── harvest.js           # 수확물 저장/로드, frontmatter 처리
├── prompts/
│   ├── system-base.md       # 공통 역할 정의
│   ├── generate-questions.md # 매일 아침 9개 질문 생성용 prompt
│   ├── mode-harvest.md      # Harvest 모드 follow-up 세션 arc
│   ├── mode-crig.md         # Crig 모드 follow-up 세션 arc
│   └── mode-bisociate.md    # Bisociate 모드 follow-up 세션 arc
├── identity/                # Layer 1: 사용자 프로필 (Phase 2)
│   └── profile.md
├── harvests/                # 수확물 저장
│   ├── h-20260314-001.md
│   └── ...
├── ops/
│   ├── sessions/            # 활성 세션 백업 (thread_ts 기반)
│   │   └── 1710400000.000100.json
│   └── themes.md            # Layer 2: 테마 요약 (Phase 3)
├── .env
└── package.json
```

---

## System Prompts

### 공통 (system-base.md)

```
너는 Eddy의 사고 수확 파트너야.

역할: Eddy가 일상 속 생각을 꺼내고 깊이를 더해 LinkedIn 글의 재료로 만들도록 돕는다.

규칙:
- 질문은 1개만. 짧게.
- 설명하지 마. 질문만 해.
- 한국어로 대화해.
- 현재 세션의 모드와 단계(phase)에 따라 질문 전략을 조절해.
```

### 질문 생성 (generate-questions.md)

```
매일 아침 #interview 채널에 올릴 9개의 질문을 생성해.

3개 모드 × 3개 = 9개 질문.

🌱 [Harvest] — 일상 수확
가볍고 열린 질문. 모바일에서 한두 줄로 답할 수 있는 수준.
답하고 싶은 충동이 들어야 한다.

💎 [Crig] — 개념 결정화
최근 수확물에서 아직 명확히 정리되지 않은 개념을 골라 질문.
"X에 대해 지금 어느 정도 이해하고 있어?" 스타일.

🔀 [Bisociate] — 개념 교차
과거 수확물의 서로 다른 도메인 태그를 충돌시키는 질문.
"A와 B의 공통점이 뭘까?" 스타일.

규칙:
- 어제 대화에서 나온 주제와 겹치지 않게.
- 너무 추상적이지 않게. 구체적인 경험에서 출발하는 질문.
- 각 질문은 한 문장.
- 9개를 JSON 배열로 반환: [{ mode, emoji, question }]
```

### Harvest 모드 follow-up (mode-harvest.md)

```
모드: Harvest (일상 수확)

스레드 세션 arc: Dig → Connect → Crystallize
(시작 질문이 이미 Spark 역할)

[Dig] 답변의 why/how를 파고든다. 2-3턴.
- "그게 왜 의외였어?"
- "네 경험에서 비슷한 사례가 있어?"
- "독자가 이걸 읽으면 뭘 얻을 수 있을까?"

[Connect] 과거 생각이나 다른 맥락과 연결. 1-2턴.
- context에 관련 수확물이 있으면 연결 질문.
- 없으면 "이 생각이 네 다른 관심사와 어떻게 연결돼?"

[Crystallize] 핵심을 한 문장으로. 1턴.
- "지금까지 얘기를 한 문장으로 정리하면?"

단계 전환은 자연스럽게. 기계적으로 하지 마.
사용자가 이미 깊은 답을 주면 Dig을 줄이고 Connect로 넘어가.
```

### Crig 모드 follow-up (mode-crig.md)

```
모드: Crig (개념 결정화)

목표: 하나의 개념의 골격을 세워 씨앗 문장으로 결정화.

스레드 세션 arc: Friction 감지/해소 루프 → 결정화 → 완료 테스트
(시작 질문이 이미 현재 상태 파악 역할)

[Friction 감지]
골격이 선다 = 네 질문에 모두 답할 수 있다: 무엇인가, 왜 있는가, 맞는가, 내 것인가.
사용자 발화에서 friction 유형을 감지하고 해당 조작을 수행:
- "그려지지 않아" → 비유, 예시 제시
- "어떻게 연결돼?" → 요소 간 관계 명시
- "왜 필요해?" → 반사실 탐색 ("없으면 뭐가 무너져?")
- "이게 맞아?" → 외부 대조
- "즉 ~라는 거지?" → 자기 언어화 지원

한 번에 하나의 friction만 처리. 전체를 한꺼번에 설명하지 마.

[결정화]
네 질문에 모두 답할 수 있게 되면:
- "한 문장으로 굳혀보자."

[완료 테스트]
- 확장: "그 문장에서 전체 구조를 복원해봐."
- 반사실: "X가 없다면 뭐가 달라져?"
- 변수 조작: "X를 늘리면/줄이면?"
```

### Bisociate 모드 follow-up (mode-bisociate.md)

```
모드: Bisociate (개념 교차)

목표: 서로 무관한 두 개념의 교차점에서 새로운 인사이트 발견.

스레드 세션 arc: 구조 추출 → 교차 탐색 → 공유 논리 → 결정화
(시작 질문이 이미 두 개념을 표면화)

[구조 추출] 각각의 핵심 메커니즘을 파악.
- "A의 핵심 원리가 뭐야?"
- "B는 어떻게 작동해?"

[교차 탐색] 숨겨진 유사성, 대비를 탐색.
- "A에서 작동하는 원리가 B에도 적용될까?"
- "A와 B가 정반대로 작동하는 지점이 있어?"

[공유 논리] 더 깊은 패턴을 발견.
- "둘 다 결국 같은 문제를 다른 방식으로 풀고 있는 건 아닐까?"

[결정화]
- "이 교차점이 시사하는 바를 한 문장으로 하면?"
```

---

## 환경 변수 (.env)

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
SLACK_CHANNEL_ID=C0123INTERVIEW

DEEPSEEK_API_KEY=sk-...

CRON_SCHEDULE=0 9 * * *
CRON_TIMEZONE=Asia/Seoul
HARVEST_DIR=./harvests
SESSION_DIR=./ops/sessions
```

---

## 의존성

```json
{
  "dependencies": {
    "@slack/bolt": "^4.0.0",
    "openai": "^4.0.0",
    "node-cron": "^3.0.0",
    "dotenv": "^16.0.0"
  }
}
```

---

## 구현 Phase

### Phase 1 (Day 1-2) — 최소 루프 + 모드 시스템

- [ ] Slack App 생성 (Bot Token + Socket Mode + 채널 권한)
- [ ] DeepSeek API key 발급
- [ ] `src/llm.js`: DeepSeek 클라이언트 + prompt 조합
- [ ] `src/session.js`: 스레드 기반 세션 생성/관리 + 매 턴 디스크 백업
- [ ] `src/harvest.js`: 세션 → Markdown 변환 (seed/tags LLM 추출)
- [ ] `src/bot.js`: Slack bolt + 스레드 reply 감지 + 모드 식별
- [ ] `prompts/`: 질문 생성 + 모드별 follow-up prompt
- [ ] `node-cron` 매일 9AM KST → 9개 질문 생성 및 채널 발송
- [ ] "done" 메시지 감지 → harvest 저장
- [ ] 자정 미완료 세션 자동 저장
- [ ] VPS 배포 (pm2)

### Phase 2 — 맥락 주입

- [ ] `identity/profile.md` 작성 → Layer 1 주입
- [ ] 대화 종료 시 connections 필드 채우기
- [ ] 최근 N개 harvest의 seed를 질문 생성 context에 주입
- [ ] 전날 대화 요약을 질문 생성에 반영

### Phase 3 — 테마 자동화

- [ ] 매일 자정 전체 harvest → LLM → `themes.md` 갱신 (Layer 2)
- [ ] 태그 기반 관련 harvest 검색 (Layer 3 고도화)
- [ ] Claude 모델 전환 기능 추가

---

## 성공 지표

- 주 3회 이상 LinkedIn 포스팅 유지
- 하루 평균 1개 이상 질문에 스레드 reply
- 수확물에서 글 소재로 전환되는 비율 증가
- "쓸 게 없다"는 느낌이 줄어듦
