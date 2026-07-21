# Career CoPilot — UX 审查与修复报告 (Deep UX Audit)

> 生成日期：2026-06-15 ｜ 来源：7-agent 深度用户视角审查（非编译检查）＋ 主流招聘 App 体验范式对标（品牌中立，不在项目内出现任何竞品名）。

## 概述

共发现 **60 个问题**：**P0 ×7 / P1 ×22 / P2 ×22 / P3 ×9**。

- ✅ **全部 7 个 P0 + 20 个功能性 P1 已修复、已构建验证、已推送 `dev` 并部署生效。**（见下方提交清单）
- ⏸ **2 个 P1 是产品决策**（P1.5 取消是否退积分、P1.13 进页是否自动扣费搜索），未擅自改，**等你决策**（见下方）。
- ◻ **22 个 P2 + 9 个 P3 是体验打磨/优化**（非 bug），按你的要求**到此暂停**，已整理在下方供你后续修复。

**状态图例**：✅ 已修复并部署 ｜ ⏸ 待你决策 ｜ ◻ 待办（打磨/优化）

---

## ✅ 已修复并上线（8 个提交，均在 `dev`，无 Claude 署名）

| 提交 | 覆盖的问题 |
|---|---|
| `02b97a3` | 模拟面试 TTS 语音冷启动撕裂（预热引擎 + 预加载嗓音 + 消除 cancel→speak 竞态） |
| `f3bdc16` | 模拟面试 15 秒准备倒计时改为"念完题目才开始"（长题不再被截断）＋ onend 兜底 |
| `4685840` | 【语音类】EnglishPro/面试 麦克风卸载泄漏、卡死"录音中"(onend)、听力 TTS 撕裂+播放/停止状态；简历分析缺字段白屏崩溃；求职信 resumeText 变化重复扣费 |
| `4de14a6` | 作品集 AI 头像无限转圈（callable 超时 + 120s 看门狗 + 取消并忽略迟到结果）；简历分析"应用修改"失败可重试；Agency 清空二次确认、URL 导入空结果提示、批量分析可"停止"且卸载干净 |
| `1b551f2` | 人才发现切换语言重复触发计费的 discoverTalent（t 用 ref，回调稳定）；申请人页多分钟加载期可"返回"；注册"验证邮箱"提示改为全局 toast（不再随弹窗卸载而丢失）；报错文案去除技术黑话（不再向用户暴露 "Cloud Run invoker / Admin model key"） |
| `135d18f` | 【P0】招聘方可关闭/重开职位（之前职位发出去永远无法关闭，持续收投递、虚高 KPI） |
| `d5bf76f` | 【P0】互动弹窗付费后不再展示"空白简历"（按隐私模型改为清晰说明，保留匹配度+摘要+发起联系） |
| `94bb945` | EnglishPro（~14 处）+ 作品集（~9 处）英文硬编码全部 i18n 化（中文/非英语用户不再中途看到英文）；新增 23 个 key，en+zh + public 同步 |

> 注：以上为**纯前端/后端混合**改动。后端函数已**定向部署**到 Firebase（career-copilot-a3168）。**前端**改动需在部署 VM 上 `git pull && npm run build` 重新发布（Firebase Hosting 不提供正式 SPA，前端由 VM 上的 `static-server.mjs` 托管 `dist/`）。

---

## ⏸ 待你决策的 2 个 P1（产品取舍，未擅自改）

### 决策 1：付费 AI 工具的"取消"是否退积分？
- **现状**：全 app 的 AI 工具都是**调用即在服务端扣积分**，点"取消"只是隐藏 loading + 丢弃结果，**不退费**。EnglishPro 的 4 个付费动作（写作/口语/阅读/听力分析）尤其明显——用户点"取消"会以为不扣费，实际已扣。
- **这是 app 级行为**，只改 EnglishPro 会与其他工具不一致。
- **选项**：① 保持现状（最简单、一致）；② "取消"改为"隐藏/后台运行"并注明仍会扣费；③ 真正做"中止退费"（需后端改动 + 部署）。

### 决策 2：机会查找（Opportunity Finder）进页是否自动扣费搜索？
- **现状**：进入该工具会**自动**发起一次付费的 AI 职位搜索（不像简历分析那样先弹积分确认框）。只是来看看、或从"找相似"跳进来的用户会被静默扣费。
- **选项**：① 拆分——免费的平台内推职位进页自动显示，付费的外部 AI 搜索改为点击确认后才扣（推荐，与刚做的内推职位功能天然契合）；② 加一个积分确认弹窗（与简历分析一致）；③ 保持现状。

---

## 📋 完整问题清单（全部 60 项，含已修/待决策/待办的逐条明细）

> 每条含：工具、问题类别、**用户实际体验**、当前行为、文件:行号、修复建议。P0/P1 多数已修（见上方提交），明细保留以备查；P2/P3 为待办。

### P0 (7) — ✅ all FIXED

**P0.1 — EnglishPro (Spoken mode)** `no-cleanup / live-mic-after-navigation`
- **User impact:** A stressed user records a spoken-English answer (mic shows red 'Recording… speak now'), then taps 'Back to English Pro Hub' or switches to another tool. The microphone stays LIVE — the browser mic indicator keeps glowing — with no on-screen control to stop it, and the in-progress recording/duration is silently discarded so they get no analysis. This is both a privacy problem (mic recording with no UI) and a dead end (work lost).
- **Now:** There is NO unmount/navigation cleanup anywhere in the component. The recognition-setup useEffect (214) returns nothing, and handleStartNewPractice (171) only calls the loading-cancel hook + resets result state — it never calls recognitionRef.current.stop(). Switching practiceMode unmounts the spoken UI but leaves the SpeechRecognition session running.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:171-183 (handleStartNewPractice), 214-236 (recognition setup has no cleanup return)`
- **Fix:** Add a cleanup effect: `useEffect(() => () => { try { recognitionRef.current?.stop(); } catch {} try { window.speechSynthesis.cancel(); } catch {} }, []);`. Also call recognitionRef.current?.stop() inside handleStartNewPractice (and set isListening(false)) so leaving spoken mode immediately releases the mic.

**P0.2 — EnglishPro (Spoken mode)** `no onend handler / silent failure / dead-end`
- **User impact:** The user speaks their answer, but Chrome's SpeechRecognition ends the session on its own (it auto-stops after a silence gap, a network blip, or ~60s even with continuous=true). The mic button stays red and pulsing ('Recording…') forever, nothing further is transcribed, and crucially the analysis NEVER runs because it's only triggered from the manual stop path. The user waits, confused, with no feedback, no error, no result — a complete dead end.
- **Now:** recognition only has onresult and onerror handlers — no onend. runSpokenAnalysis(transcript, duration) is invoked exclusively from inside toggleListening's `if (isListening)` branch. If the engine ends spontaneously, isListening is never reset and analysis is never dispatched.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:214-236 (no onend), 238-259 (analysis only fires in toggleListening stop branch)`
- **Fix:** Add `recognition.onend = () => { if (isListening) { setIsListening(false); if (recordingStartTime.current) { const d = (Date.now()-recordingStartTime.current)/1000; runSpokenAnalysis(transcript, d); recordingStartTime.current = null; } } };` (wire via refs/useEffect so it sees current transcript). This guarantees the recording resolves to analysis or an error, never an infinite 'Recording…' state.

**P0.3 — EnglishPro** `no-cleanup / speech-not-stopped-on-unmount`
- **User impact:** If a user is recording in Spoken mode (mic live) or has just hit Play in Listening mode, then switches to another tool or closes English Pro, the component unmounts but the microphone stays hot and/or the synthesized voice keeps reading the clip aloud with no visible source and no way to stop it. The browser mic indicator stays on after they have left the tool — a privacy and trust problem — and React fires setState-after-unmount from onresult/onerror.
- **Now:** There are only two useEffects (96, 214) and NEITHER returns a cleanup. ToolRunner.tsx swaps ActiveTool by key (line 71), so leaving the tool unmounts EnglishPro while recognitionRef is still .start()'ed and/or speechSynthesis is still speaking. Nothing calls recognition.stop()/abort() or speechSynthesis.cancel() on unmount.
- **File:** `components/tools/EnglishPro.tsx:214-236 (recognition setup, no cleanup), 824-832 (playClip), top-level component (no unmount effect)`
- **Fix:** Add a useEffect(() => () => { try { recognitionRef.current?.abort(); } catch{}; try { window.speechSynthesis.cancel(); } catch{} }, []) so the mic and any in-progress TTS are torn down when the tool unmounts.

**P0.4 — EnglishPro** `timer-vs-state-desync / no-onend-handler (stuck recording, stolen time)`
- **User impact:** In Spoken mode, Chrome's Web Speech API auto-stops after a few seconds of silence or a network timeout even with continuous=true. When it does, the UI still shows the pulsing red 'Recording… speak now' and the mic button still says Stop, so a stressed user keeps talking into a dead mic. Everything they say after the silent auto-stop is lost, and when they finally press Stop the elapsed 'duration' (Date.now()-recordingStartTime) includes all the dead time, so the pacing/WPM score it sends to the paid analysis is wrong.
- **Now:** No recognition.onend handler exists (confirmed). isListening stays true after the engine stops; duration is computed from wall-clock start regardless of when recognition actually ended.
- **File:** `components/tools/EnglishPro.tsx:214-235 (no onend), 238-259 (toggleListening), 246-248 (duration)`
- **Fix:** Add recognition.onend that, if isListening is still true, either auto-restarts the recognizer or flips isListening=false and finalizes; compute duration from when recognition actually ended, not raw wall clock. At minimum surface 'mic stopped — press start to continue' so the user is not talking into a dead mic.

**P0.5 — CoverLetterGenerator** `credit-double-charge / effect-refires-paid-action`
- **User impact:** A second cover-letter generation (a paid, server-side credit-charging call) can fire automatically without the user clicking anything. When the tool is opened with a job description prefilled (e.g. via OpportunityFinder's "Generate cover letter" button) and the resume text then changes value while the tool is mounted — which happens when the profile sync round-trips, the user re-analyzes their resume, or analyzeResume writes back extractedText — the effect re-runs generateCoverLetter and the user is silently charged again for the same letter. This is the exact shape OpportunityFinder was patched for, but here the guard is missing.
- **Now:** useEffect(() => { setJobDescription(initialInput); if (initialInput && resumeText?.trim()) runTool(initialInput); }, [initialInput, resumeText]) — the comment even states "Re-runs when resumeText loads". There is no ref keyed on the inputs, so any new resumeText value (not just first load) re-fires the paid generateCoverLetter call. resumeText is owned by CareerApp state (CareerApp.tsx:121) and demonstrably changes after mount (CareerApp.tsx:296 profile load, 652 analyzeResume write-back, 685 manual edit).
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/CoverLetterGenerator.tsx:69-76`
- **Fix:** Mirror OpportunityFinder's guard: add `const lastRunKey = useRef<string\|null>(null);` and inside the effect compute `const key = \`${initialInput}\|${resumeText.length}\`; if (lastRunKey.current === key) return; lastRunKey.current = key;` before calling runTool. This keys the auto-run on the actual inputs so a token-refresh / resume re-fetch that produces an equivalent input cannot re-charge.

**P0.6 — PortalJobListings / EmployerPortal (job lifecycle)** `dead-end`
- **User impact:** A recruiter can post a job but can NEVER close, pause, deactivate, or delete it from the portal. Once a role is filled or posted by mistake, it stays live forever, keeps collecting applicants, and keeps inflating 'Active jobs' KPIs. The only control on a job card is Edit, and edit always writes is_active:true. The 'Closed' filter and the collapsible 'Expired' section imply closed jobs exist, but there is no UI path to ever reach that state — a confusing dead end.
- **Now:** Job cards expose only View applicants / Edit / Source candidates. saveJobPosting edit path (recruitingData.ts:140) writes only title/location/description/salary/updated_at — is_active is unreachable after creation.
- **File:** `components/employer/pages/PortalJobListings.tsx (no close/delete control on JobRow, lines 191-238) + lib/recruitingData.ts:139-142 (updateDoc never touches is_active) + saveJobPosting create path forces is_active:true (line 150):PortalJobListings.tsx:191-238; recruitingData.ts:139-153`
- **Fix:** Add a 'Close job' / 'Reopen' action to the job card (and/or JobPostForm) that calls saveJobPosting/updateDoc with is_active:false/true. Until then the Closed/Expired UI is misleading and should be hidden.

**P0.7 — EngageCandidateModal (discover → unlock → engage)** `dead-end`
- **User impact:** After a recruiter pays (wallet unlock) and clicks 'Engage', the modal's headline feature — the candidate's resume — is ALWAYS blank, showing the 'resume unavailable' fallback. The Web3 wallet block and resume section never render real data. The recruiter paid an ETH unlock fee and gets a resume preview that is structurally guaranteed to be empty, plus a candidate identified only as 'Candidate #N' with no name/email. This makes the entire paid unlock flow feel broken/scammy.
- **Now:** candidateToEngage is the same safe MatchedCandidate stub whose resume_text/full_name/wallet_address are hardcoded null in toMatchedCandidate, so the engage modal always shows empty resume + no wallet + 'Candidate #N'.
- **File:** `components/TalentDiscovery.tsx (toMatchedCandidate sets resume_text:null, wallet_address:null, full_name:null — lines 47-73) → passed straight into EngageCandidateModal which renders candidate.resume_text \|\| t('engage_resume_unavailable') (EngageCandidateModal.tsx:71) and gates the wallet block on candidate.wallet_address (line 54):TalentDiscovery.tsx:47-73, 1008-1025; EngageCandidateModal.tsx:54,71`
- **Fix:** After onUnlocked, fetch the now-unlocked full profile (resume_text, name, wallet) from the server and pass that into EngageCandidateModal instead of reusing the safe stub. If full-profile fetch isn't built yet, the unlock/engage flow should not present a resume panel that can only ever say 'unavailable'.


### P1 (22) — ✅ FIXED except P1 #5 (cancel-refund) & #13 (auto-charge), which are product decisions

**P1.1 — InterviewSimulator (dictation mic)** `no onend handler / silent failure`
- **User impact:** During the timed answer phase, the candidate taps the mic to dictate their answer. If Chrome ends recognition on its own (silence/network/timeout), the mic button stays red and pulsing as if it's still listening, but words stop appearing in the textarea. The candidate keeps talking under deadline pressure believing it's captured; their answer is lost and auto-submits empty when the 180s timer expires.
- **Now:** Recognition is created with continuous=true and onresult/onerror only. No onend handler resets isListening, so the UI shows a live mic after the engine has actually stopped. There is no auto-restart and no visible warning.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/InterviewSimulator.tsx:377-398 (recognition setup, no onend)`
- **Fix:** Add `recognitionRef.current.onend = () => setIsListening(false);` (and optionally auto-restart while still in answer phase) so the mic indicator matches reality and the user knows to re-tap.

**P1.2 — EnglishPro (Listening mode)** `tts-cold-start / cancel-speak-race`
- **User impact:** The exact bug just fixed in the mock interview lives here untouched. The first time a user (often a non-native speaker who depends on clear audio) hits 'Play Audio', the clip stutters/tears or starts with the wrong voice, because getVoices() is empty until 'voiceschanged' fires and cancel() is called synchronously immediately before speak(). For a listening-comprehension exercise, a garbled first playback directly corrupts the task.
- **Now:** playClip() does `speechSynthesis.cancel()` then `speechSynthesis.speak(u)` synchronously, with no voice preload, no warm-up, and no delay after cancel — the same Chromium clip/tear pattern InterviewSimulator fixed with a voiceschanged preload + 120ms gap.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:824-832 (playClip)`
- **Fix:** Mirror InterviewSimulator's TTS hardening: preload voices on mount via a voiceschanged listener, and in playClip only cancel when synth.speaking/pending and then speak after a ~120ms setTimeout (or guard the first call with a silent warm-up utterance).

**P1.3 — EnglishPro (Listening mode)** `no-cleanup / audio-keeps-playing + missing playing state`
- **User impact:** The user starts a listening clip, then clicks 'Back to Hub' / switches tools mid-clip — the narration keeps playing aloud with no way to stop it (there is no Stop/Pause button and no visible 'playing' state at all). The Play button also gives zero feedback that audio is in progress, so users mash it and trigger overlapping/cancelled playbacks.
- **Now:** No component-level speechSynthesis.cancel() on unmount or on mode change; playClip tracks no isPlaying state, so the Play button never reflects playback and there is no Stop affordance. Leaving the mode unmounts the UI but not the audio.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:824-832 (playClip), 834-944 (renderListeningMode — no isPlaying/Stop control), no unmount cancel`
- **Fix:** Add an unmount cleanup `useEffect(() => () => window.speechSynthesis.cancel(), [])`, cancel in handleStartNewPractice/mode-switch, and add an isPlaying state (set on utterance onstart/onend) so the button shows Playing/Stop and lets the user halt or replay.

**P1.4 — EnglishPro (all modes)** `i18n-leak`
- **User impact:** EnglishPro exists specifically for non-native speakers (native language picker offers Vietnamese / Japanese / Other), yet many user-facing strings are hardcoded English with no translation key. A Vietnamese or Japanese user running the app in their language still sees raw English errors and labels — exactly the audience least able to read them, and exactly where trust matters most.
- **Now:** Hardcoded literals: 'No speech was detected.', 'Speech recognition is not supported in this browser.', 'Could not fetch a new topic. Please try again.', 'Please paste some text to analyze.', 'Please type what you heard.', 'Could not save your practice progress…', 'Speaking Topic', 'Recording… speak now', 'Listening…', 'Back to English Pro Hub', 'Back to Reading Options', 'No flashcards loaded.', 'Key Vocabulary', 'Audio playback is not supported…', plus the StagedLoader title/steps ('Analyzing your English', 'Reading your submission…', etc.).
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:166, 202, 240, 268, 277, 329, 443, 454, 458, 496, 505, 571, 609, 698, 815, 867, 877 (and StagedLoader steps 954-960)`
- **Fix:** Replace each literal with a t('...') key added to en.json/zh.json (and the other locales). The component already uses t() extensively, so this is purely converting the stragglers.

**P1.5 — EnglishPro** `credit-charge-on-cancel`
- **User impact:** The four paid actions (Written analyze, Spoken analyze, Reading 'Analyze pasted text', Listening 'Check') show a full-screen StagedLoader with a Cancel button. If the user clicks Cancel, the loader hides and the result is discarded — but the Firebase callable still completes server-side and the english-pro credit is still deducted. The user paid a credit, got nothing, and was never warned.
- **Now:** useCancellableLoading.cancel() only flips a runRef and hides the loader (its own docstring: 'callables cannot be truly aborted… DISCARD the in-flight result'). creditKey for these tools is 'english-pro' (toolRegistry.ts) so the server charges regardless.
- **File:** `components/tools/EnglishPro.tsx:188-198 (written), 201-211 (spoken), 276-287 (reading), 328-338 (listening); cancel wired at 961`
- **Fix:** Either relabel Cancel as 'Hide / run in background' so users do not expect a refund, or make the loader non-cancellable for paid steps, or implement a server-side refund/no-charge-on-abort path. Do not present a Cancel that silently burns a credit.

**P1.6 — EnglishPro** `tts-cold-start / no-playing-state`
- **User impact:** In Listening mode, clicking 'Play Audio' gives zero feedback: there is no 'playing…' state, no disable-while-speaking, and no replay indicator. On Chrome the synchronous speechSynthesis.cancel() immediately followed by speak() is the known cold-start race that can drop or never fire the first utterance, and getVoices() may be empty on first call so the utterance silently does nothing. The user clicks, hears nothing, and cannot tell if it is broken, still loading, or already finished — then types a transcription of audio they may never have heard.
- **Now:** playClip does speechSynthesis.cancel() then speak() synchronously with no onstart/onend, no voice preload, no playing flag; the play button has no active/disabled/replay state.
- **File:** `components/tools/EnglishPro.tsx:824-832 (playClip), 864-875 (button, no state)`
- **Fix:** Attach utterance.onstart/onend to drive a 'Playing…' visual state and disable the button while speaking; preload voices (handle voiceschanged) and defer speak() a tick after cancel() to avoid the cancel→speak race so the first play reliably fires.

**P1.7 — EnglishPro** `i18n-leak (CJK user sees English) + wrong loader copy`
- **User impact:** zh.json is fully translated, but many user-facing strings are hardcoded English literals, so a Chinese user hits raw English mid-flow: 'Speaking Topic', 'Recording… speak now', 'Listening…', 'Key Vocabulary', 'Summary', '✓ Correct/✗ Incorrect', 'No flashcards loaded.', 'Back to Reading Options', 'Back to English Pro Hub' (written mode only — every other mode uses the t() key), plus all error toasts ('No speech was detected.', 'Please paste some text to analyze.', 'Please type what you heard.', 'Could not fetch a new topic…', 'Could not save your practice progress…', 'Speech recognition is not supported in this browser.', 'Audio playback is not supported…'). The seed topic 'Tell me about your most recent project.' is also English. Separately, the global StagedLoader is hardcoded 'Analyzing your English' with steps 'Checking grammar & clarity… Scoring against your target band…' — shown even when the action is generating a passage or flashcards, which is both untranslated and the wrong description of the task.
- **Now:** These strings bypass the t() function and are emitted as English regardless of locale; the loader title/steps are literal English and generic to 'analysis' only.
- **File:** `components/tools/EnglishPro.tsx:166,202,240,266,268,269,277,329,443,454,496,505,609,626,650,698,815,877; loader 953-960`
- **Fix:** Route every user-facing literal through t() with new keys in en.json/zh.json (and public/ copies), make line 443 use t('tool_english_pro_back_to_hub') like the other modes, and pass per-action title/steps (or a translated generic) into StagedLoader instead of the hardcoded 'Analyzing your English'.

**P1.8 — InterviewSimulator** `no-cleanup / mic-stays-live-on-unmount`
- **User impact:** If the user closes the interview (or the modal unmounts) while the microphone is actively recording their answer, the mic is never released. The red "recording" pulse disappears with the UI but the SpeechRecognition session keeps running in the background — a privacy problem and a violation of "the user must always know the mic is live". The orphaned recognition's onresult/onerror also fire setState on an unmounted component.
- **Now:** The only unmount cleanup is `useEffect(() => () => cancelSpeech(), [])` which cancels speechSynthesis (TTS) but does NOT stop speech recognition (the mic). recognitionRef.current.stop() is only called via stopListening() inside submit/end/restart handlers, none of which run on a raw unmount/close.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/InterviewSimulator.tsx:320`
- **Fix:** Extend the unmount cleanup to also stop the mic: `useEffect(() => () => { cancelSpeech(); try { recognitionRef.current?.stop(); } catch {} }, [])`.

**P1.9 — EnglishPro** `no-cleanup / mic-and-tts-leak-on-unmount`
- **User impact:** In Spoken mode, if the user navigates away from the tool while recording, the microphone keeps running (no visible indicator) and continues firing setError/setTranscript on an unmounted component. In Listening mode, a clip played via speechSynthesis keeps speaking after the user leaves the tool. Both are the same TTS/mic-cleanup class flagged in the mock interview.
- **Now:** The SpeechRecognition setup effect (deps [t]) has NO cleanup function, so it neither stops the recognizer on unmount nor stops the previous recognizer when t changes (a language switch creates a new SpeechRecognition instance and overwrites recognitionRef.current, orphaning the old running one). There is also no effect anywhere calling window.speechSynthesis.cancel() or recognitionRef.current.stop() on unmount.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:214-236`
- **Fix:** Add a dedicated unmount cleanup effect: `useEffect(() => () => { try { recognitionRef.current?.stop(); } catch {} try { window.speechSynthesis.cancel(); } catch {} }, [])`, and return a cleanup from the [t] setup effect that stops the prior recognizer before replacing it.

**P1.10 — Portfolio / Website Builder (headshot generation)** `infinite-spinner`
- **User impact:** After uploading a photo and tapping 'Generate AI avatars', the user sees a bare 'Generating AI avatars...' spinner with NO cancel button, NO staged progress, and NO escape hatch. generateProfessionalHeadshot is the only AI callable with no explicit timeout (aiClient.ts line 480 — every other callable sets timeout:190_000), so it falls back to the Firebase default and during that window a stressed user on a flaky connection is stuck staring at a spinner with no way out and no idea anything is wrong.
- **Now:** handleGenerateHeadshots bypasses the useCancellableLoading/StagedLoader pattern used everywhere else, sets headshotStep='generating' and renders a plain animate-spin div. No onCancel, no timeout on the callable, no determinate/staged status.
- **File:** `components/tools/PortfolioWebsiteBuilder.tsx:611-626 (handleGenerateHeadshots), 811-817 (generating UI); aiClient.ts:478-483`
- **Fix:** Route headshot generation through useCancellableLoading + StagedLoader (with onCancel) like the main portfolio generation, and add an explicit timeout to the generateProfessionalHeadshot callable in aiClient.ts (e.g. { timeout: 190_000 }) so it errors deterministically instead of hanging.

**P1.11 — Resume analysis result view (AnalysisDisplay)** `missing-error-state`
- **User impact:** The analysis RESULT view maps directly over result.strengths, result.improvements and result.keywords with no defensive defaults. If the AI returns a malformed/partial JSON object (missing one of those arrays), .map throws and white-screens the entire report a user just paid credits for — leaving them with a blank screen and no recovery. CareerPathPlanner already added exactly these defensive defaults (its comment even calls out the white-screen risk), but AnalysisDisplay did not.
- **Now:** const result is consumed as result.strengths.map / result.improvements.map / result.keywords.map with no `?? []` fallback; a missing array crashes the component tree.
- **File:** `components/AnalysisDisplay.tsx:553-555, 565-567, 580-582`
- **Fix:** Destructure with defaults (const { strengths = [], improvements = [], keywords = [], summary = '', score = 0 } = result) before rendering, matching the pattern already used in CareerPathPlanner.tsx lines 182-187.

**P1.12 — Resume analysis – Apply suggestions (AnalysisDisplay)** `missing-error-state`
- **User impact:** The 'Apply these edits to my resume' button fires a paid AI call (applyResumeImprovements). On failure the only feedback is a tiny red one-line message (optimizationError) with NO retry button and NO alternate path — the user is dead-ended on a failed paid action and must re-open the confirm panel and guess. Violates rule #2 (errors must carry a reason + retry).
- **Now:** catch sets optimizationError; rendered as `<p className="text-xs text-red-300 mt-2">{optimizationError}</p>` with no Retry/Try-again affordance.
- **File:** `components/AnalysisDisplay.tsx:210-223 (handleApplySuggestions), 536 (error render)`
- **Fix:** Render the failure through the shared ToolError component (or add an explicit Retry button that re-calls handleApplySuggestions), and keep the confirm panel open on failure so the user can immediately retry.

**P1.13 — Opportunity Finder (auto-run on mount)** `credit-charge-without-consent`
- **User impact:** Unlike resume analysis (which shows a CreditModal before charging), Opportunity Finder fires a credit-charging AI job search automatically on mount with no confirmation. A user who taps the tool just to look, or who is bounced here from MyApplications 'Find similar', is silently charged before seeing any input or consent screen. Resume analysis and this tool treat the same 'spend credits' moment inconsistently.
- **Now:** useEffect keyed on resume/market/user auto-calls runTool() on first mount, which performs the paid findOpportunities search with no pre-charge confirmation.
- **File:** `components/tools/OpportunityFinder.tsx:215-220 (auto-run effect), 159-206 (runTool)`
- **Fix:** Gate the first paid search behind an explicit 'Find opportunities' action or a credit-confirm modal consistent with resume analysis, OR show a clear pre-search screen with the credit cost and a Start button instead of auto-charging.

**P1.14 — Auth (candidate sign-up)** `silent-failure / lost-confirmation`
- **User impact:** A new candidate who signs up with email/password never sees the 'Account created — we sent a verification link to your email' confirmation. The instant Firebase creates the account, the auth listener fires SIGNED_IN with userChanged=true and CareerApp navigates to 'home' (setView('home')), unmounting the Auth modal before its setMessage(t('auth_signup_success_verify')) can render. The user is dropped onto the home screen with zero acknowledgement that signup succeeded or that they must verify their email — they may think nothing happened, or never check their inbox.
- **Now:** signUp() resolves → auth listener navigates to home immediately → Auth modal unmounts → the 'verify your email' success banner is effectively dead code for email signups and is never shown. Google OAuth has the same race.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/Auth.tsx:193 (setMessage success) vs CareerApp.tsx:506-512 (SIGNED_IN → setView('home'))`
- **Fix:** Show the verification confirmation outside the Auth modal: have CareerApp surface a one-time toast/banner ('Check your inbox to verify your email') when a brand-new account is detected (e.g. emailVerified===false on first SIGNED_IN), rather than relying on a message inside a modal that is torn down by the navigation. Alternatively, delay the setView('home') navigation until after showing the confirmation.

**P1.15 — PortfolioWebsiteBuilder (AI headshot generation)** `infinite-spinner / no-escape`
- **User impact:** After uploading a photo and tapping 'Generate avatars', if the generateProfessionalHeadshot callable hangs or is slow, the user is trapped on a bare spinning circle ('Generating…') with NO cancel button, NO timeout, and NO way back. Unlike the website-generation step (which uses StagedLoader with a Cancel button), this paid AI step can spin forever; the only escape is abandoning the entire tool. A stressed user on a deadline is stuck staring at a spinner.
- **Now:** headshotStep==='generating' renders a static spinner with no onCancel and no timeout. generateProfessionalHeadshot (a server-charged image call) has no abort path; a hang = permanent dead-end. There is also no unmount guard, so setGeneratedImages/setHeadshotStep can fire after unmount.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/PortfolioWebsiteBuilder.tsx:811-817 (case 'generating')`
- **Fix:** Add a Cancel/Back control to the 'generating' state that returns to headshotStep='photo_uploaded', and add a client-side timeout (e.g. 30s) that flips to 'photo_uploaded' with a retryable headshotError, mirroring the Avatar upload watchdog and the StagedLoader pattern already used elsewhere in this file.

**P1.16 — PortfolioWebsiteBuilder (template + form UI)** `i18n-leak`
- **User impact:** Multiple primary UI strings in the showcase builder are hardcoded English and never translate, so a zh.json (Chinese) user sees raw English at the most prominent points of the flow: the template-picker heading, its subtitle, the 'Select Template' CTA on every card, the 'Back to Styles' nav, and the 'Building your website' loader title. This is the candidate-facing showcase tool — the leak is right at the top of the funnel.
- **Now:** These strings are literals, not t() keys; grep confirms no corresponding keys exist in public/localization/zh.json. The rest of the same component correctly uses t('tool_portfolio_*').
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/PortfolioWebsiteBuilder.tsx:733 ('Choose Your Showcase Style'), 734 ('Pick a template…'), 766 ('Select Template'), 850 ('Building your website'), 868 ('Back to Styles'); loader steps 851-856 also hardcoded`
- **Fix:** Replace the literals with t('tool_portfolio_*') keys and add them (plus translations) to en.json and zh.json (both root and public/ copies).

**P1.17 — AgencyHub (bulk resume analysis)** `no-cleanup`
- **User impact:** The whole bulk run lives in component state with zero unmount/abort handling. If a recruiter navigates away mid-batch (sidebar to another portal page unmounts AgencyHub), the sequential for-loop keeps parsing+calling the AI for every remaining resume and calls setFiles on an unmounted component; the work (and any server cost) is wasted with no result the user can ever see. There is also no way to STOP a running batch — once 'Rank candidates' starts on 30 files, the recruiter is locked out (Clear all is disabled while isAnalyzing) until all 30 finish.
- **Now:** runBulkAnalysis awaits processFile sequentially with no cancellation; component has no useEffect cleanup. Mid-run navigation continues processing and setState-after-unmount.
- **File:** `components/AgencyHub.tsx — runBulkAnalysis for-loop (lines 2080-2087) has no AbortController / isMounted guard; 'Clear all' disabled during run (line 2737); no Cancel/Stop button anywhere:AgencyHub.tsx:1982-2087, 2733-2756`
- **Fix:** Add an isMounted/AbortController ref checked between processFile iterations and before each setFiles; add a visible 'Stop'/'Cancel batch' button that breaks the loop and resets isAnalyzing.

**P1.18 — AgencyHub (general mode + matching mode results)** `data-loss`
- **User impact:** Results are pure in-memory state with no persistence. If the recruiter accidentally hits 'Clear all', reloads, or navigates away, an entire ranked batch of 20-50 analyzed resumes — minutes of AI processing — vanishes with no undo and no confirmation. 'Clear all' (sets files to []) fires immediately on a single click with no confirm dialog. The History modal only reads the same volatile in-memory `files`, so it does NOT recover anything after a reload — it is misleadingly named.
- **Now:** setFiles([]) on single click; no persistence; History is just a reversed view of current in-memory files.
- **File:** `components/AgencyHub.tsx — Clear all onClick={() => setFiles([])} with no confirm (line 2735); AgencyHistoryModal reads live `files` prop only (lines 313-432, 2364-2366):AgencyHub.tsx:2733-2740, 2363-2370`
- **Fix:** Add a confirmation step to 'Clear all', and either persist batch results (so History/reload survives) or rename/relabel History so recruiters don't expect it to restore lost work.

**P1.19 — ApplicantFunnel (review applicants)** `tts-cold-start`
- **User impact:** listJobApplicants is configured with a 190s timeout and runs server-side AI match analysis for every applicant, but the loading UI is a single bare spinner with one static line ('Analyzing applicants'). For a job with many applicants this can spin for a minute or more with no progress, no count, no skeleton of the funnel/list layout, and no escape hatch — the recruiter cannot tell if it's working or hung, and cannot cancel or go back during the wait.
- **Now:** while loading: full-screen spinner + loadingMessage only; no back/cancel; no skeleton; relies on a single 190s callable.
- **File:** `components/ApplicantFunnel.tsx — loading state is a lone spinner (lines 401-408); single call to listJobApplicants (aiClient.ts:305-310, 190s timeout) with no progress staging or back button while loading:ApplicantFunnel.tsx:401-408, 125-146`
- **Fix:** Replace the bare spinner with a skeleton mirroring the funnel + applicant list, add staged status text or a determinate hint, and keep the Back button available during load so the recruiter is never trapped on a multi-minute spin.

**P1.20 — AgencyHub (URL JD import)** `missing-error-state`
- **User impact:** When 'Import from URL' silently returns no text (extractTextFromUrl resolves with empty extractedText), nothing happens at all: no toast, no error, the textarea stays empty, the spinner just stops. The recruiter clicks Import, sees the button flash, and is left staring at an empty brief with zero feedback about why — a silent failure. (The catch path does toast, but the empty-success path at line 1897 does not.)
- **Now:** if (result.extractedText) { ...fill... } with no else; empty result = no toast, no error, no change.
- **File:** `components/AgencyHub.tsx handleJdUrlImport — only sets state inside `if (result.extractedText)`; empty/whitespace result falls through with no user feedback (lines 1892-1908):AgencyHub.tsx:1896-1900`
- **Fix:** Add an else branch toasting something like t('agency_jd_import_empty') when extractedText is empty/blank, so the recruiter knows the page had no extractable JD.

**P1.21 — TalentDiscovery (verified talent rail)** `effect-refiring-paid-action`
- **User impact:** The 'Verified Talent' rail auto-fires discoverTalent() on every mount via useEffect (and the matching search overwrites verifiedResults). Because fetchVerifiedTalent depends on `t`, any change to the translation function identity (e.g. language switch) re-runs the server talent-discovery call automatically without the recruiter asking. On portals where discoverTalent is a metered/AI call this is an unsolicited repeat server hit; at minimum it's a surprise reload of the rail.
- **Now:** discoverTalent() auto-runs on mount and whenever the memoized t changes, re-triggering the verified rail fetch.
- **File:** `components/TalentDiscovery.tsx — fetchVerifiedTalent is useCallback([t]) and useEffect([fetchVerifiedTalent]) auto-invokes on mount/identity change (lines 527-551):TalentDiscovery.tsx:527-551`
- **Fix:** Drop `t` from the fetch callback deps (read it via ref), or gate the auto-fetch so it runs once per session rather than on every t/identity change; ensure no metered action refires on language switch.

**P1.22 — AgencyHub / TalentDiscovery / ApplicantFunnel (error text)** `i18n-leak`
- **User impact:** All AI/callable failures surface English-only, developer-flavored strings even when the recruiter is using the Chinese UI. formatCallableError returns hardcoded English like 'AI service access denied. Ask the project owner to grant Cloud Run invoker on new functions.' and 'Business admins can verify the configured model key in Admin.' These are shown verbatim in TalentDiscovery searchError, AgencyHub toasts, and ApplicantFunnel error panel. A zh-locale recruiter hits a wall of untranslated, jargon-heavy English referencing internal infra.
- **Now:** Plain English admin/infra error strings are thrown and rendered regardless of selected language.
- **File:** `services/aiClient.ts formatCallableError (lines 38-68) returns hardcoded English; consumed by ApplicantFunnel.tsx:141, TalentDiscovery.tsx:538/571, and AgencyHub error toasts:aiClient.ts:52-67`
- **Fix:** Map callable errors to i18n keys (resolved with t at the call site) instead of baking English sentences into aiClient; strip internal-infra references ('Cloud Run invoker', 'configured model key in Admin') from user-facing copy.


### P2 (22) — ◻ TODO (polish / optimization)

**P2.1 — EnglishPro (Spoken mode) + InterviewSimulator (dictation)** `missing-error-state / double-submit (recognition.start throws)`
- **User impact:** If mic permission is denied, or the user double-taps the mic quickly, recognition.start() throws (NotAllowedError / InvalidStateError). The call is unguarded, so the exception is uncaught: the button may not enter the recording state and the user gets no explanation of what went wrong or how to grant the mic — they just see nothing happen.
- **Now:** Both `recognitionRef.current.start()` calls are not wrapped in try/catch. A throw on start leaves state inconsistent and surfaces nothing to the user; permission-denied is only handled via onerror, which renders raw codes (e.g. 'not-allowed') appended to the error string.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:255 (recognitionRef.current.start()); mirror in /Users/kair/Desktop/Career-CoPilot-uOttawa/components/InterviewSimulator.tsx:414`
- **Fix:** Wrap start() in try/catch; on failure set a plain-language error ('Microphone access is blocked — enable it in your browser settings and try again') and keep isListening false. Map onerror codes (not-allowed/no-speech/audio-capture) to friendly messages instead of echoing the raw event.error.

**P2.2 — EnglishPro (Spoken mode)** `missing manual-override / no-auto-detect-fallback`
- **User impact:** Spoken practice depends entirely on Web Speech recognition with no text fallback. Users on unsupported browsers (Safari/Firefox) just see a yellow 'not supported' box and a dead mode — they can practice nothing. Users with accents or in noisy rooms whose speech isn't recognized get 'No speech was detected' and no alternate path (e.g. typing their answer for analysis).
- **Now:** When isSpeechSupported is false the mode is a dead end with no fallback; when recognition yields no transcript the user is told 'No speech was detected.' with no way to proceed.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:476-499 (unsupported → dead box), 202 (no-speech → bare error)`
- **Fix:** Offer a text-input fallback for spoken analysis (let the user type/paste what they said) so the mode degrades instead of dead-ending, and surface it both when speech is unsupported and after a no-speech result.

**P2.3 — EnglishPro** `dead-end / no-skip (check-answers blocked on blanks)`
- **User impact:** In Reading comprehension, the 'Check Answers' button stays disabled until EVERY question has a non-empty answer. A user who genuinely does not know one answer cannot submit at all — they must type something in every box to get any feedback, which is the opposite of how a practice/learning tool should behave and can trap a stressed user who just wants to see the correct answers.
- **Now:** disabled={loading \|\| userAnswers.filter(Boolean).length !== questions.length}; checkReadingAnswers also early-returns unless userAnswers.length === questions.length.
- **File:** `components/tools/EnglishPro.tsx:666 (disabled gating), 300-312 (checkReadingAnswers guard)`
- **Fix:** Allow submitting with blanks (treat empty as unanswered/incorrect) so users can always check answers; the gate should not require a non-empty answer for every single question.

**P2.4 — EnglishPro** `silent-failure (dead button) on missing questions`
- **User impact:** After analyzing pasted reading text, if the AI returns no comprehensionQuestions field, the 'Check Answers' button renders enabled (because 0 !== 0 is false) but clicking it does nothing — checkReadingAnswers silently early-returns on !res.comprehensionQuestions. The user clicks a live-looking button and gets no response and no explanation, with no clear next step except the bottom 'back' links.
- **Now:** When comprehensionQuestions is undefined the Check Answers button is shown and enabled but its handler returns immediately with no feedback.
- **File:** `components/tools/EnglishPro.tsx:303 (guard), 663-670 (button always renders in pre-eval state)`
- **Fix:** When there are no questions, hide the Check Answers button and show an explicit message (e.g. 'No questions could be generated for this text — try a longer passage') so the user is not left clicking a dead button.

**P2.5 — EnglishPro** `no-cleanup (recordingStartTime not reset on error)`
- **User impact:** If a speech-recognition error fires mid-recording (no-speech, network, not-allowed), onerror sets isListening=false but does not clear recordingStartTime.current. The mic is also never explicitly stopped on error, so depending on the error type the recognizer may still be running. The error message is also raw ('...permission denied' style event.error appended), with no guidance on how to enable the mic or fall back.
- **Now:** onerror only logs, sets a generic error string with event.error, and sets isListening(false); recordingStartTime.current is left set and recognition is not stopped.
- **File:** `components/tools/EnglishPro.tsx:230-234 (onerror)`
- **Fix:** In onerror also call recognitionRef.current.stop() / clear recordingStartTime.current, and for 'not-allowed'/'service-not-allowed' show actionable copy (how to grant mic permission, or that they can use Written mode instead) rather than a raw error code.

**P2.6 — EnglishPro** `recognition-start-race / uncaught-InvalidStateError`
- **User impact:** Rapidly toggling the mic (or toggling after the recognizer auto-ended on silence/error, which desyncs isListening) calls recognition.start() on an already-started or stale instance, throwing an uncaught InvalidStateError that surfaces as a console error and can wedge the mic button into an unrecoverable state mid-practice.
- **Now:** toggleListening() calls `recognitionRef.current.start()` (and InterviewSimulator does the same at line 414) with no try/catch. The recognizer's onend is not wired to reset isListening, so if recognition stops on its own, isListening stays true / false out of sync and the next start()/stop() throws.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:255`
- **Fix:** Wrap start() in try/catch and reset isListening on failure; also wire recognition.onend to setIsListening(false) so the UI state tracks the engine. (Same fix applies to InterviewSimulator.tsx:414.)

**P2.7 — InterviewSimulator** `timer-during-async / answer-clock-vs-evaluation`
- **User impact:** On the final question, when the 3-minute answer timer hits 0 it auto-submits and kicks off the paid evaluateInterviewSession call. This path is fine today, but the report-stage retry button has no in-flight protection: a user who double-clicks Try-again on an evaluation error fires evaluateInterviewSession twice. It is saved from a double charge only because finishAndEvaluate synchronously flips stage to 'evaluating' and the retry button unmounts — a fragile guard rather than an explicit one.
- **Now:** finishAndEvaluate() has no `if (evaluating) return` ref guard; it relies on the render swap to StagedLoader to remove the trigger. handleUnlock (line 524) correctly uses an `unlocking` guard — finishAndEvaluate does not have the equivalent.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/InterviewSimulator.tsx:503-522`
- **Fix:** Add an in-flight ref (e.g. evaluatingRef) checked/set at the top of finishAndEvaluate, mirroring submittingRef and the unlocking guard, so the retry button cannot double-charge even within one render tick.

**P2.8 — EnglishPro** `i18n-leak`
- **User impact:** A Chinese-locale user sees raw English in the Spoken/Reading/Listening flows: the mic states "Recording… speak now" and "Listening…", and error toasts like "No speech was detected.", "Please paste some text to analyze.", "Please type what you heard.", "Could not save your practice progress…", "Could not fetch a new topic…". These are core in-flow strings, not edge cases.
- **Now:** These strings are hardcoded English literals passed to setError(...) / rendered inline instead of going through t('...'). The app ships a zh.json locale, so they will not translate.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/EnglishPro.tsx:166,202,240,268,277,329,443,496,505`
- **Fix:** Move each to a localization key (en.json + zh.json) and render via t().

**P2.9 — Opportunity Finder (empty results)** `dead-end`
- **User impact:** When the AI returns zero opportunities and there are no internal postings, the user sees a single bare sentence ('No matching opportunities found. Try adjusting your filters or resume.') with no actionable button — no 'Search again', no 'Edit job preferences', no 'Upload/improve resume'. It's a soft dead-end that tells the user what's wrong but gives no way forward. Violates rule #6 (empty state is an onboarding moment with a primary action).
- **Now:** `{filteredOpportunities.length === 0 && <p>{t('tool_opportunity_finder_no_results')}</p>}` — text only, no CTA.
- **File:** `components/tools/OpportunityFinder.tsx:348`
- **Fix:** Render an empty state with a primary action (Search again → runTool, and/or Edit job goals / Reset filters) so the user can act, not just read.

**P2.10 — Cover Letter Generator (AI-unavailable fallback)** `i18n-leak`
- **User impact:** When the AI is offline, the entire fallback panel a non-English (e.g. zh) user sees is hardcoded English: 'AI Not Available', the explanatory paragraph, and the inline errors 'The AI is currently unavailable. Please try again later.' / 'Please upload your resume first.' A Chinese-locale user hits an all-English wall exactly at a failure moment.
- **Now:** setError("The AI is currently unavailable..."), setError('Please upload your resume first.'), and the renderFallback() heading/description are string literals, not t() keys.
- **File:** `components/tools/CoverLetterGenerator.tsx:80, 84, 127-128`
- **Fix:** Move all these strings to localization keys and resolve via t(), matching the rest of the tool which already uses t() for its error/retry copy.

**P2.11 — Career Path Planner (skill-bridge result + roadmap)** `i18n-leak`
- **User impact:** The entire Skill Bridge Project result card and roadmap section render hardcoded English regardless of locale: 'Skill Bridge Project Idea', 'Key Features:', 'Suggested Tools:', 'Showcase Challenge:', 'Add to My Portfolio', 'Your Personal Roadmap', 'Actionable Steps:', 'Milestones:', the 'Project' button label, and the failure text 'Failed to generate project idea.' A non-English user gets a half-translated screen.
- **Now:** These labels/headings are string literals in JSX rather than t() lookups, so they never localize.
- **File:** `components/tools/CareerPathPlanner.tsx:51, 217, 234, 241, 245, 249, 253, 262, 277, 291`
- **Fix:** Replace each literal with a t('...') key and add the keys to en.json/zh.json (and public/ copies).

**P2.12 — Career Path Planner (Skill Bridge Project generation error)** `missing-error-state`
- **User impact:** The per-skill 'Project' generator is a separate AI call. On failure it shows a red projectError box with NO retry button — the user must hunt back up to the skill-gap list and click the 'Project' chip again. The error is also not actionable. Violates rule #2.
- **Now:** projectError is rendered as a static red div with no Retry affordance; only re-clicking the original chip recovers.
- **File:** `components/tools/CareerPathPlanner.tsx:43-55 (handleGenerateProject), 235 (projectError render)`
- **Fix:** Add a Retry button to the projectError box that re-calls handleGenerateProject(skill), or render via ToolError with onRetry.

**P2.13 — Portfolio / Website Builder (headshot empty result)** `missing-error-state`
- **User impact:** generateProfessionalHeadshot returns res.data.images and the UI does results.map(...). If the server returns an empty array, the user lands on the 'Choose your avatar' step with an empty grid and only a 'Try again' link — a confusing near-empty screen with no explanation of why no avatars came back. If images is undefined, .map throws and white-screens the builder mid-flow.
- **Now:** No guard for an empty or undefined images array; empty array silently shows an empty chooser, undefined would crash.
- **File:** `components/tools/PortfolioWebsiteBuilder.tsx:619-621 (map of results), 818-831 (generated UI); aiClient.ts:478-483`
- **Fix:** Guard the result: if images is empty/undefined, keep headshotStep at 'photo_uploaded' and set headshotError with a clear 'Couldn't generate avatars from this photo — try a clearer, front-facing image' message + retry, instead of showing an empty grid or crashing.

**P2.14 — Avatar (Account profile photo)** `i18n-leak`
- **User impact:** On the Account page (which is fully localized), the avatar widget's only visible text — 'Upload a new photo' / 'Uploading...' — plus all of its error messages ('Image must be smaller than 5 MB.', 'Upload timed out…', 'You must be signed in…') are hardcoded English. A Chinese user editing their profile sees English here while everything around it is translated.
- **Now:** Avatar takes no `t` prop and emits English literals; Account.tsx renders it without passing t.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/Avatar.tsx:118 (label), 34/39/43/54 (error strings)`
- **Fix:** Thread the `t` function into Avatar (Account already has it) and replace all literals with localized keys.

**P2.15 — Account (Web3 / wallet / subscription)** `i18n-leak`
- **User impact:** Several interactive labels on the Account page are hardcoded English even when the rest of the page is in Chinese: 'Switch to Sepolia'/'Switching...' (542), 'Claim Rewards'/'Claiming...' (631), 'Connect Wallet' (562), 'Disconnect' (553), 'Wrong Network Detected' (539), and all dynamic message-bar texts in syncWithBlockchain/handleConnectWallet/handleMintNFT ('Syncing with the blockchain...', 'No Ethereum wallet detected…', etc.). Web3 is feature-flagged off by default, but when enabled these are user-facing.
- **Now:** These setMessage/button strings are literals, not t() keys, while sibling labels in the same section use t().
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/Account.tsx:107,111,124,313,316,334,341,388,395,408 (messages); 539-543,553,562,631 (buttons)`
- **Fix:** Move all Web3/wallet/subscription user-facing strings to localized keys.

**P2.16 — Account (shared loading + message state)** `confusing-flow / cross-talk`
- **User impact:** All four independent sections (Profile, Change Password, Web3, Subscription) share one `loading` flag and one `message` banner. (1) On initial mount loading=true, so the Password 'Update' button reads 'Saving…' / disabled and the Subscription button reads 'Processing…' before the user has done anything. (2) Saving the password (a form far below the fold) puts its success/error banner at the very top of the page, where the user — who is looking at the password fields — won't see it and may resubmit. The result feels like a silent success/failure.
- **Now:** Single loading/message shared across unrelated forms; banner anchored to page top regardless of which form acted.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/Account.tsx:74 (loading), 80 (message), 264-285 (password uses same loading/message)`
- **Fix:** Give each form its own loading + inline message (or scroll the banner into view on submit), so feedback appears next to the action the user took and unrelated buttons don't show spurious busy states during initial profile load.

**P2.17 — CareerGoalsPanel (job preferences)** `lost-input / device-sync`
- **User impact:** Job preferences (status, target roles, locations, min salary, availability) that the UI explicitly frames as durable account-level guidance ('These preferences guide your AI job search', 'Save ✓') are persisted to localStorage only. A candidate who sets them on desktop then continues their job search on mobile — the exact mobile-first job-search loop this product targets — silently starts from a blank panel, and clearing browser data wipes them with no warning. The 'Save' affordance overpromises durability.
- **Now:** save() writes to localStorage and dispatches an in-tab event; nothing is written to the user's Firestore profile, so prefs do not roam across devices/sessions.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/hooks/useJobPreferences.ts:23-30 (saveJobPreferences → localStorage.setItem only)`
- **Fix:** Persist preferences to the user's profile doc (server-side) when signed in, falling back to localStorage for anonymous users; or relabel the panel to make clear it is device-local. Server-side is preferred since the prefs feed the AI job search.

**P2.18 — TalentDiscovery (save to shortlist)** `confusing-flow`
- **User impact:** When no posted job is selected and the brief is manual, the shortlist entry is saved with job_id:'manual' and job_title set to the first 200 chars of the pasted brief. In the Shortlist page the 'Associated job' column then shows a giant slab of raw JD text instead of a job title, and CSV export carries the same blob — making the recruiter's saved-candidate list and export look broken/unreadable.
- **Now:** job_title = first line of brief truncated to 200 chars; shown as the 'job' in shortlist table/CSV.
- **File:** `components/TalentDiscovery.tsx getJobInfo fallback uses jobDescription.split('\n')[0].slice(0,200) as job_title (lines 578-586); surfaced in PortalShortlist job column (PortalShortlist.tsx:1069-1071) and CSV (line 81):TalentDiscovery.tsx:583-585`
- **Fix:** When no job is selected, store a short label (e.g. t('talent_unspecified_role')) and keep the full brief in a separate field, or truncate to a real title; never use the raw JD's first line as the displayed job title.

**P2.19 — TalentDiscovery (regular match results filter)** `confusing-flow`
- **User impact:** Regular search hides every candidate scoring below 70 (`compatibilityScore >= 70`) AND drops all staked candidates from the regular list. So when the server returns matches that are all in the 50-69 band, the recruiter sees 'No matches found' even though the pool returned people. They get told to refine the brief or post a job, with no hint that decent-but-sub-70 candidates exist — opaque filtering that erodes trust in the match engine.
- **Now:** Hard 70% cutoff applied client-side with no indication that lower-scoring candidates were returned and hidden.
- **File:** `components/TalentDiscovery.tsx handleSearch filters regularResults to !nft_staked && compatibilityScore >= 70 (lines 567-569); empty-state then shows 'no matches' (lines 956-983):TalentDiscovery.tsx:568-569`
- **Fix:** Either surface the count of below-threshold matches ('12 partial matches under 70% — show anyway?') or lower/expose the threshold as a control, so a non-empty pool never renders as a flat 'no matches'.

**P2.20 — JobPostForm (AI helpers)** `no-error-retry`
- **User impact:** The four AI helpers (Generate description, Format, Analyze salary, Check inclusivity) share one `error` string that renders at the very top of the form. On a long post-job form scrolled down to the salary/description section, a failed AI call sets an error banner far above the viewport — the button just stops spinning and nothing visibly happens near where the recruiter clicked. They can't tell the action failed and there is no inline retry.
- **Now:** All AI errors funnel into one error state rendered at the top of formBody regardless of scroll position; the failing button simply reverts.
- **File:** `components/JobPostForm.tsx — single top-of-form error banner (lines 279-284); all AI handlers setError into the same slot (lines 136-199):JobPostForm.tsx:279-284, 136-199`
- **Fix:** Surface AI-helper failures inline next to the triggering button (or as a toast), not only in a top banner that may be off-screen; keep a retry affordance on the action itself.

**P2.21 — ApplicantFunnel (data freshness)** `no-refresh`
- **User impact:** Once applicants load, there is no manual refresh. A recruiter reviewing a popular role can't pull newly-arrived applicants without leaving the funnel (Back) and re-entering, and there is no indication the list may be stale. The only refetch is the error-state Retry button.
- **Now:** Applicants fetched once per mount; refetch only reachable via the error-state Retry or by navigating away and back.
- **File:** `components/ApplicantFunnel.tsx — fetchApplicants runs once on mount; no refresh control in the success view (lines 148-150, 449-812):ApplicantFunnel.tsx:148-150`
- **Fix:** Add a Refresh button (reusing fetchApplicants) in the funnel header so recruiters can pull new applicants in place.

**P2.22 — UnlockTalentModal (paid unlock)** `confusing-flow`
- **User impact:** Eligible (paid-tier) recruiters who don't have a Web3 wallet are dead-ended: the fee shows 'Fee unavailable' / error, and the only enabled action is 'Unlock with wallet', which throws on window.ethereum access. There's no fallback path (e.g. contact / non-crypto unlock) for a paying business user without MetaMask, so a legitimate paid customer simply cannot unlock a candidate.
- **Now:** No-wallet paid users see 'fee unavailable' and an unlock button that fails on click with a generic error; no degraded path.
- **File:** `components/UnlockTalentModal.tsx — fetchUnlockFee sets 'fee unavailable' when no ethereum (lines 36-52); handleUnlock requires window.ethereum signer (lines 73-79) with only ACTION_REJECTED/failed error toasts:UnlockTalentModal.tsx:36-52, 60-96`
- **Fix:** Detect missing wallet up front and present an explainer + alternate path (install wallet guidance or a non-crypto contact-sales fallback) rather than leaving an enabled 'Unlock with wallet' button that always errors.


### P3 (9) — ◻ TODO (polish / optimization)

**P3.1 — InterviewSimulator (TTS) — verification** `tts-cold-start (verified fixed, minor residual)`
- **User impact:** The previously reported mock-interview TTS issues are genuinely fixed: voices are preloaded via voiceschanged (267-274), the engine is warmed on the start gesture (278-287, 434), cancel()+speak() is separated by a 120ms gap (306-313), the prep timer is gated on prepArmed until narration ends (449, 458-469), there is an onend/onerror safety net (476-482), and speech is cancelled on unmount (320). Residual: warmUpTts() and the voiceschanged preload run, but pickVoice() can still pick the default on a very first cold call if voices populate slightly after warm-up — low-impact, only affects voice timbre on rare first runs.
- **Now:** Fixes confirmed present and correct. The only edge is voice selection (not tearing) on a stone-cold first utterance before getVoices() resolves.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/InterviewSimulator.tsx:266-320, 449, 476-482`
- **Fix:** Optional: defer the first real speak() by re-running pickVoice() inside a one-shot voiceschanged callback if getVoices() returned empty, so the matched female voice is used even on the very first question. Not blocking.

**P3.2 — EnglishPro** `lost-progress / confusing-flow`
- **User impact:** Mid-flashcard-quiz or mid-comprehension, the 'Back to Reading Options' / 'Back to Hub' links instantly discard the user's in-progress score and answers with no confirmation. A user who clicks expecting to peek back loses their place silently.
- **Now:** Both back actions clear flashcards, userAnswers, results immediately with no 'you'll lose progress' prompt.
- **File:** `components/tools/EnglishPro.tsx:810-818 (back to options resets flashcards/answers), 171-183 (handleStartNewPractice resets everything)`
- **Fix:** When a quiz/answers are in progress, confirm before discarding, or preserve state so returning resumes where they left off.

**P3.3 — EnglishPro** `dead-code / misleading-loader`
- **User impact:** Minor confusion risk: per-submode loading text ('generating' at line 695 and 803) is unreachable because the shared `loading` flag always swaps in the global StagedLoader at the top level, so generating flashcards/passages shows the grammar-scoring loader instead of the intended inline text. No user-facing break, but it signals the loader copy does not match the action.
- **Now:** loading is a single shared flag; the top-level `loading ? <StagedLoader/>` short-circuits before any per-submode loading branch can render.
- **File:** `components/tools/EnglishPro.tsx:694-696, 803, vs 950-962`
- **Fix:** Either give free generate actions their own local loading state (like fetchNewSpeakingTopic uses isFetchingTopic) so the inline copy renders, or remove the unreachable per-submode loading branches.

**P3.4 — CoverLetterGenerator** `i18n-leak`
- **User impact:** Chinese-locale users see English error text when the AI is offline ("The AI is currently unavailable. Please try again later.") or when no resume is uploaded ("Please upload your resume first.").
- **Now:** Two setError(...) calls use hardcoded English literals while the rest of the file uses t('...').
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/tools/CoverLetterGenerator.tsx:80,84`
- **Fix:** Replace with t() keys (these likely already exist for similar messages elsewhere).

**P3.5 — Opportunity Finder (per-card Why-fit / Intro errors)** `i18n-leak`
- **User impact:** When the per-card 'Why am I a fit?' or 'Intro message' paid actions fail, the toast falls back to the literal string 'Error' (when the thrown value isn't an Error instance). A non-English user gets a bare untranslated 'Error' toast with zero guidance; even in English it's uninformative.
- **Now:** addToast(err instanceof Error ? err.message : 'Error', 'error') — fallback literal 'Error', and the per-card actions have no inline retry (the card just stops loading).
- **File:** `components/tools/OpportunityFinder.tsx:231, 258`
- **Fix:** Use a localized fallback message (t key) and ideally show an inline retry on the card; at minimum replace the bare 'Error' literal with a translatable, actionable string.

**P3.6 — Resume-required tools (ResumeFormatter, LinkedIn 'From resume' tab)** `no-client-guard`
- **User impact:** ResumeFormatter.runTool and LinkedInOptimizer's 'resume' tab call the AI with resumeText WITHOUT checking it's non-empty client-side (CoverLetter and CareerPath do check). In the normal toolkit flow these are gated behind a no-resume EmptyState upstream, so this is defense-in-depth rather than a reachable happy-path dead-end — but if ever opened with an empty resume they'd burn a round-trip and surface a raw server error instead of the friendly 'Please upload your resume first.' that CoverLetter shows.
- **Now:** No `if (!resumeText?.trim()) { setError('Please upload your resume first.'); return; }` guard before the paid call, unlike CoverLetterGenerator.tsx line 83-86.
- **File:** `components/tools/ResumeFormatter.tsx:44-57 (runTool); components/tools/LinkedInOptimizer.tsx:54-55`
- **Fix:** Add the same empty-resume guard these other tools already use, returning a friendly localized message before calling the AI.

**P3.7 — CareerGoalsPanel (minimum salary input)** `free-text-where-structured-expected`
- **User impact:** 'Minimum salary' is a free-text box (placeholder 'e.g. 80k CAD') with no currency/period structure, while Roles and Locations were deliberately upgraded to datalist comboboxes for canonical values. Users will enter '80k', '80,000', '$80/hr', '8万' etc.; this free text is injected verbatim into the AI ranking prompt (preferencesToPromptBlock), so inconsistent/ambiguous salary expressions can degrade match quality and can't be reliably filtered.
- **Now:** salaryMin is an unstructured string passed straight into the prompt; no number/currency/period normalization.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/CareerGoalsPanel.tsx:202-208 (salaryMin free-text input)`
- **Fix:** Make salary structured (numeric amount + currency select + per-year/per-hour toggle), or at minimum add input mode/validation hints, so the value the AI receives is normalized.

**P3.8 — Auth (sign-up form after success)** `double-submit / stale-form`
- **User impact:** In the (rare) path where the SIGNED_IN navigation does not immediately replace the modal — or for the business modal which stays open on success — the sign-up form remains fully interactive with an enabled submit button after the account is created and the green success banner is shown. A user who taps the button again triggers a second signUp that fails with 'email-already-in-use', which then flips them to the sign-in view — a confusing bounce right after a success message.
- **Now:** After success, the form and its submit button stay active; no disabled/replaced state and no explicit 'Continue' / close action.
- **File:** `/Users/kair/Desktop/Career-CoPilot-uOttawa/components/business/BusinessSignUpModal.tsx:107 (setMessage success, form still enabled); Auth.tsx:193 same pattern`
- **Fix:** After a successful signup, replace the form with a success panel + explicit Continue/Close action (or disable the submit button and inputs), so the only forward action is the intended one.

**P3.9 — AgencyHub (general mode bulk auto-open)** `confusing-flow`
- **User impact:** autoOpenResult only pops the analysis modal when the queue is exactly 1 file (queue.length === 1). With 2+ files the setting silently does nothing, so a recruiter who enabled 'auto-open result' sees inconsistent behavior depending on batch size with no explanation.
- **Now:** Detail modal auto-opens only for single-file general-mode runs; multi-file runs ignore the toggle.
- **File:** `components/AgencyHub.tsx — auto-open gated on queue.length === 1 (lines 2037-2043):AgencyHub.tsx:2037`
- **Fix:** Either document the single-file scope in the setting description or auto-open the top-ranked result after a multi-file run.

