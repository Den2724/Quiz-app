// Простая SPA-логика для index.html и topic.html

const STORAGE_KEY = 'chem-cleaning-progress-v1';
const STORAGE_TOUCH_KEY = 'chem-cleaning-progress-touch';
// UI-состояние для SPA (чтобы не сбрасывать номер вопроса при переключении вкладок)
window.__QUIZ_UI_STATE__ = window.__QUIZ_UI_STATE__ || { topicIdx: {} };

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { topics: {} };
  } catch (e) {
    return { topics: {} };
  }
}

function saveProgress(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Обновляем «маячок» последнего изменения для простого опроса
  localStorage.setItem(STORAGE_TOUCH_KEY, String(Date.now()));
}

function formatPct(x) {
  return Math.round(x * 100);
}

function formatDec2(x) {
  try { return Number(x).toFixed(2).replace('.', ','); } catch { return '0,00'; }
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function calcTopicStats(topicId, data, progress) {
  const q = data.topics[topicId]?.questions || [];
  const total = q.length;
  const answered = (progress.topics[topicId]?.answers && Object.keys(progress.topics[topicId].answers).length) || 0;
  let sum = 0;
  const ans = progress.topics[topicId]?.answers || {};
  for (const k of Object.keys(ans)) {
    const a = ans[k];
    sum += (typeof a.score === 'number') ? a.score : (a.correct ? 1 : 0);
  }
  return { total, answered, correct: sum, pct: total ? answered/total : 0 };
}

function calcOverallStats(data, progress) {
  let total = 0, answered = 0, correct = 0;
  for (const t of data.order) {
    const q = data.topics[t].questions.length;
    total += q;
    const pr = progress.topics[t];
    if (pr?.answers) answered += Object.keys(pr.answers).length;
    if (pr?.answers) {
      for (const k of Object.keys(pr.answers)) {
        const a = pr.answers[k];
        correct += (typeof a.score === 'number') ? a.score : (a.correct ? 1 : 0);
      }
    }
  }
  const pct = total ? answered/total : 0;
  return { total, answered, correct, pct };
}

function renderIndex() {
  if (!window.quizData) return;

  const progress = loadProgress();
  const topicsEl = document.getElementById('topics');
  const overallEl = document.getElementById('overall');

  const overall = calcOverallStats(quizData, progress);
  if (overallEl) overallEl.innerHTML = `
    <div class="label">Общий прогресс</div>
    <div class="progress-bar" aria-hidden="true"><div class="progress-fill" style="width:${formatPct(overall.pct)}%"></div></div>
    <div class="stats">Ответы: ${overall.answered}/${overall.total} • Верно: ${formatDec2(overall.correct)}</div>
  `;

  const parts = [];
  for (const id of quizData.order) {
    const t = quizData.topics[id];
    const st = calcTopicStats(id, quizData, progress);
    parts.push(`
      <article class="topic">
        <h3>${t.title}</h3>
        <p>${t.desc}</p>
        <div class="progress-bar" aria-hidden="true"><div class="progress-fill" style="width:${formatPct(st.pct)}%"></div></div>
        <div class="stats">Ответы: ${st.answered}/${st.total} • Верно: ${formatDec2(st.correct)}</div>
        <div class="spacer"></div>
        <a class="btn" href="#topic=${encodeURIComponent(id)}">Перейти к тесту</a>
      </article>
    `);
  }
  if (topicsEl) topicsEl.innerHTML = parts.join('');
}

function parseQuery() {
  const out = {};
  const q = location.search.slice(1).split('&');
  for (const kv of q) {
    if (!kv) continue;
    const [k, v] = kv.split('=').map(decodeURIComponent);
    out[k] = v;
  }
  return out;
}

function isMulti(question) { return question.type === 'multi'; }

function renderQuestion(container, topicId, index, data, progress) {
  const t = data.topics[topicId];
  const q = t.questions[index];
  const total = t.questions.length;
  const saved = progress.topics[topicId]?.answers?.[index];
  const wasSubmitted = !!saved;
  const multi = isMulti(q);

  const selected = new Set(wasSubmitted ? saved.selected : []);

  const optionsHtml = q.options.map((opt, i) => {
    const inputType = multi ? 'checkbox' : 'radio';
    const checked = selected.has(i) ? 'checked' : '';
    return `
      <label class="option">
        <input type="${inputType}" name="q${index}" value="${i}" ${checked} />
        <div>
          <div>${opt.text}</div>
          ${wasSubmitted ? renderOptionExplain(opt, i, q) : ''}
        </div>
      </label>
    `;
  }).join('');

  container.innerHTML = `
    <article class="question" data-index="${index}">
      <h3>Вопрос ${index+1} из ${total}</h3>
      <div class="meta">${multi ? 'Выберите все правильные варианты' : 'Выберите один правильный вариант'}</div>
      <div>${q.text}</div>
      <ul class="options">${optionsHtml}</ul>
      <div class="actions">
        <button class="btn" id="submit">Проверить</button>
        <button class="btn btn-secondary" id="clear">Сбросить выбор</button>
      </div>
      ${wasSubmitted ? renderAnswerBlock(q) : ''}
    </article>
  `;

  const questionEl = container.querySelector('.question');
  questionEl.addEventListener('change', (e) => {
    if (e.target && e.target.name === `q${index}`) {
      if (!multi) {
        // радио — снимаем другие
        for (const inp of questionEl.querySelectorAll('input[type="radio"][name="q'+index+'"]')) {
          if (inp !== e.target) inp.checked = false;
        }
      }
    }
  });

  questionEl.querySelector('#clear').addEventListener('click', () => {
    for (const inp of questionEl.querySelectorAll('input')) inp.checked = false;
  });

  questionEl.querySelector('#submit').addEventListener('click', () => {
    const chosen = [];
    questionEl.querySelectorAll('input:checked').forEach((inp) => {
      chosen.push(Number(inp.value));
    });

    // Проверка: хотя бы один выбран
    if (chosen.length === 0) {
      alert('Сначала выберите вариант(ы) ответа.');
      return;
    }

    const ev = evaluate(q, new Set(chosen));

    // Сохраняем
    progress.topics[topicId] ||= { answers: {}, correctCount: 0 };
    const prev = progress.topics[topicId].answers[index];
    progress.topics[topicId].answers[index] = { selected: chosen, correct: ev.score === 1, score: ev.score };
    // Пересчёт суммы баллов по подтеме
    let sum = 0;
    const ans = progress.topics[topicId].answers;
    for (const k of Object.keys(ans)) sum += (typeof ans[k].score === 'number') ? ans[k].score : (ans[k].correct ? 1 : 0);
    progress.topics[topicId].correctCount = sum;
    saveProgress(progress);

    // Перерисовка вопроса и прогресса
    renderQuestion(container, topicId, index, data, progress);
    updateBars(topicId, data, progress);
  });
}

function renderOptionExplain(opt, idx, q) {
  // Пояснения после отправки: показываем для выбранных неверных и для правильных
  const cls = opt.correct ? 'ok' : 'bad';
  const title = opt.correct ? 'Правильно:' : 'Неверно:';
  const exp = opt.explain || (opt.correct ? 'Этот вариант является верным.' : 'Этот вариант не соответствует материалу.');
  return `<div class="explain ${cls}"><strong>${title}</strong> ${exp}</div>`;
}

function renderAnswerBlock(q) {
  const rightList = q.options
    .map((o, i) => ({...o, i}))
    .filter(o => o.correct)
    .map(o => `<li><strong>${o.text}</strong> — ${o.explain || 'Правильный вариант.'}</li>`) 
    .join('');
  // Попробуем вычислить частичный балл по сохранённому ответу
  let scoreLine = '';
  try {
    const progress = loadProgress();
    const titleText = (document.getElementById('topic-title')?.textContent) || '';
    let topicId = null;
    for (const id of window.quizData.order) {
      if (window.quizData.topics[id].title === titleText) { topicId = id; break; }
    }
    if (topicId) {
      const qIdx = Number(document.querySelector('.question')?.getAttribute('data-index') || -1);
      const saved = progress.topics[topicId]?.answers?.[qIdx];
      if (saved) {
        const ev = evaluate(q, new Set(saved.selected || []));
        scoreLine = `<div class="stats" style="margin-top:6px;">Зачтено: <strong>${formatDec2(ev.score)}</strong> из 1,00</div>`;
      }
    }
  } catch {}
  return `
    <div class="answer-block">
      <h4>Правильный ответ${isMulti(q) ? 'ы' : ''}</h4>
      <ul style="margin:0; padding-left:18px;">${rightList}</ul>
      ${scoreLine}
    </div>
  `;
}

function evaluate(q, selectedSet) {
  const correctIdx = new Set(q.options.map((o, i) => o.correct ? i : -1).filter(i => i !== -1));
  if (q.type === 'single') {
    const sel = [...selectedSet][0];
    const ok = correctIdx.has(sel);
    return { score: ok ? 1 : 0 };
  }
  let sCorrect = 0, sWrong = 0;
  for (const i of selectedSet) {
    if (correctIdx.has(i)) sCorrect++; else sWrong++;
  }
  const raw = Math.max(0, sCorrect - sWrong);
  const denom = Math.max(1, correctIdx.size);
  const score = clamp(raw / denom, 0, 1);
  return { score };
}

function updateBars(topicId, data, progress){
  const topicBar = document.getElementById('bar-topic');
  const overallBar = document.getElementById('bar-overall');
  const topicStats = document.getElementById('topic-stats');
  const overallStats = document.getElementById('overall-stats');
  if (!topicBar || !overallBar) return;
  const st = calcTopicStats(topicId, data, progress);
  const ov = calcOverallStats(data, progress);
  topicBar.style.width = formatPct(st.pct) + '%';
  overallBar.style.width = formatPct(ov.pct) + '%';
  topicStats.textContent = `Ответы: ${st.answered}/${st.total} • Верно: ${formatDec2(st.correct)}`;
  overallStats.textContent = `Ответы: ${ov.answered}/${ov.total} • Верно: ${formatDec2(ov.correct)}`;
}

// --- SPA Router for index.html ---
function getRoute(){
  const h = location.hash.replace(/^#/, '');
  if (!h) return { name: 'home' };
  const m = h.match(/^topic=(.+)$/);
  if (m) return { name: 'topic', id: decodeURIComponent(m[1]) };
  return { name: 'home' };
}

function showHome(){
  const home = document.getElementById('home-view');
  const topic = document.getElementById('topic-view');
  if (home) home.style.display = '';
  if (topic) topic.style.display = 'none';
  renderIndex();
}

function renderTopicPageId(topicId){
  if (!quizData.topics[topicId]) { showHome(); return; }
  const t = quizData.topics[topicId];
  const progress = loadProgress();

  // Заголовки
  const ttl = document.getElementById('topic-title');
  const sub = document.getElementById('topic-subtitle');
  if (ttl) ttl.textContent = t.title;
  if (sub) sub.textContent = t.desc;

  // Навигация
  let idx = (typeof window.__QUIZ_UI_STATE__.topicIdx[topicId] === 'number')
    ? window.__QUIZ_UI_STATE__.topicIdx[topicId]
    : 0;
  const quizEl = document.getElementById('quiz');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const resetTopicBtn = document.getElementById('reset-topic');
  const backSpa = document.getElementById('spa-back');

  const commitIdx = () => { window.__QUIZ_UI_STATE__.topicIdx[topicId] = idx; };
  const rerender = () => {
    commitIdx();
    renderQuestion(quizEl, topicId, idx, quizData, progress);
    updateBars(topicId, quizData, progress);
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.textContent = idx === t.questions.length - 1 ? 'Завершить' : 'Далее';
  };

  if (prevBtn) prevBtn.onclick = () => { if (idx > 0) { idx--; rerender(); } };
  if (nextBtn) nextBtn.onclick = () => {
    if (idx < t.questions.length - 1) { idx++; rerender(); }
    else { location.hash = ''; }
  };
  if (resetTopicBtn) resetTopicBtn.onclick = () => {
    if (confirm('Сбросить все ответы по этой подтеме?')) {
      progress.topics[topicId] = { answers: {}, correctCount: 0 };
      saveProgress(progress);
      rerender();
    }
  };
  if (backSpa) backSpa.onclick = (e) => { e.preventDefault(); location.hash = ''; };

  rerender();
}

function showTopic(id){
  const home = document.getElementById('home-view');
  const topic = document.getElementById('topic-view');
  if (home) home.style.display = 'none';
  if (topic) topic.style.display = '';
  renderTopicPageId(id);
}

function route(){
  const r = getRoute();
  if (r.name === 'topic') showTopic(r.id); else showHome();
}

function renderTopicPage() {
  const q = parseQuery();
  const topicId = q.topic;
  if (!topicId || !quizData.topics[topicId]) {
    // Если открыт topic.html напрямую — отправляем на SPA главную
    location.replace('index.html');
    return;
  }
  const t = quizData.topics[topicId];
  const progress = loadProgress();

  // Заголовки
  document.getElementById('topic-title').textContent = t.title;
  document.getElementById('topic-subtitle').textContent = t.desc;

  // Навигация
  let idx = 0;
  const quizEl = document.getElementById('quiz');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const resetTopicBtn = document.getElementById('reset-topic');
  const backLink = document.getElementById('back-link');

  const rerender = () => {
    renderQuestion(quizEl, topicId, idx, quizData, progress);
    updateBars(topicId, quizData, progress);
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = idx === t.questions.length - 1 ? 'Завершить' : 'Далее';
  };

  prevBtn.addEventListener('click', () => { if (idx > 0) { idx--; rerender(); }});
  nextBtn.addEventListener('click', () => {
    if (idx < t.questions.length - 1) { idx++; rerender(); }
    else { location.href = 'index.html#'; }
  });
  resetTopicBtn.addEventListener('click', () => {
    if (confirm('Сбросить все ответы по этой подтеме?')) {
      progress.topics[topicId] = { answers: {}, correctCount: 0 };
      saveProgress(progress);
      rerender();
    }
  });

  if (backLink) backLink.href = 'index.html#';

  rerender();
}

function whenDataReady(cb, tries = 20) {
  if (window.quizData) return cb();
  if (tries <= 0) return;
  setTimeout(() => whenDataReady(cb, tries - 1), 25);
}

document.addEventListener('DOMContentLoaded', () => {
  // Сливаем импортированные из документа темы один раз
  if (window.docTopics && !window.__DOC_MERGED__) {
    window.__DOC_MERGED__ = true;
    try {
      if (Array.isArray(window.docTopics.order)) {
        for (const id of window.docTopics.order) {
          if (!quizData.topics[id]) {
            quizData.topics[id] = window.docTopics.topics[id];
            quizData.order.push(id);
          }
        }
      }
    } catch (e) { /* no-op */ }
  }

  whenDataReady(() => route());
  window.addEventListener('hashchange', () => whenDataReady(route));
  // На случай BFCache/отложенных инициализаций – гарантируем повтор
  setTimeout(() => whenDataReady(route), 0);
  // Запускаем периодическое обновление главной (на случай BFCache/особенностей file://)
  startIndexAutoRefresh();
});

window.addEventListener('storage', () => whenDataReady(route));

// Обновление при возврате назад (BFCache) и при фокусе вкладки
window.addEventListener('pageshow', () => whenDataReady(route));
window.addEventListener('focus', () => whenDataReady(route));
document.addEventListener('visibilitychange', () => { if (!document.hidden) whenDataReady(route); });

// Дублируем на window.onload для максимально широкой совместимости
window.addEventListener('load', () => whenDataReady(route));

let indexRefreshTimer = null;
function startIndexAutoRefresh(){
  if (indexRefreshTimer) return;
  // В первые ~15 секунд обновляем каждую секунду, затем реже
  let ticks = 0;
  indexRefreshTimer = setInterval(() => {
    ticks++;
    whenDataReady(renderIndex);
    if (ticks > 15) { clearInterval(indexRefreshTimer); indexRefreshTimer = null; }
  }, 1000);
}
