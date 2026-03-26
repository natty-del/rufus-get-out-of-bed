const TASK_DEFS = [
  { id: 'bed',      name: 'Get out of bed', emoji: '🛏️',  startOff: 0,  endOff: 2,  fullPts: 5,  halfPts: 2  },
  { id: 'dressed',  name: 'Get dressed',    emoji: '👔',   startOff: 2,  endOff: 11, fullPts: 20, halfPts: 10 },
  { id: 'porridge', name: 'Eat porridge',   emoji: '🥣',   startOff: 11, endOff: 31, fullPts: 10, halfPts: 5  },
  { id: 'teeth',    name: 'Clean teeth',    emoji: '🦷',   startOff: 31, endOff: 39, fullPts: 5,  halfPts: 2  },
  { id: 'bag',      name: 'Check bag',      emoji: '🎒',   startOff: 39, endOff: 45, fullPts: 10, halfPts: 5  },
];

const PERFECT_BONUS = 20;
const STORAGE_KEY   = 'rufus_morning_v3';
const DEFAULT_START = '06:45';
const DEFAULT_PIN   = '1234';

let state = null;
let tickInterval = null;
let confettiAnim = null;
let confettiParticles = [];
let voicesLoaded = false;
let speechUnlocked = false;
let selectedVoice = null;

function parseTimeStr(str) {
  const [h, m] = str.split(':').map(Number);
  return { h, m };
}
function timeStrToMinutes(str) {
  const { h, m } = parseTimeStr(str);
  return h * 60 + m;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function nowSeconds() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatTime(str) {
  const { h, m } = parseTimeStr(str);
  const ampm = h < 12 ? 'am' : 'pm';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}
function formatSecondsMMSS(totalSec) {
  if (totalSec < 0) totalSec = 0;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function minsToStr(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = Math.floor(totalMins % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function dayOfWeek(dateStr) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const d = new Date(dateStr + 'T12:00:00');
  return days[d.getDay()];
}
function taskWindows(def, startMins) {
  return { startMins: startMins + def.startOff, endMins: startMins + def.endOff };
}
function taskSecsRemaining(def, startMins) {
  const { endMins } = taskWindows(def, startMins);
  return (endMins * 60) - nowSeconds();
}

function defaultDayState() {
  return {
    tasks: TASK_DEFS.map(def => ({
      id: def.id,
      status: 'upcoming',
      completedAt: null,
      wasOnTime: null,
      pointsEarned: null,
      audioFired: { min3: false, min2: false, min1: false, sec30: false, countdown: false, expired: false }
    })),
    todayPoints: 0,
    allOnTime: false,
    celebrationShown: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function initState() {
  const saved = loadState();
  const today = todayStr();
  if (saved) {
    if (!saved.pin) saved.pin = DEFAULT_PIN;
    if (!saved.startTime) saved.startTime = DEFAULT_START;
    if (typeof saved.muted === 'undefined') saved.muted = false;
    if (!saved.history) saved.history = {};
    if (typeof saved.allTimeTotal === 'undefined') saved.allTimeTotal = 0;
    if (typeof saved.streak === 'undefined') saved.streak = 0;
    if (typeof saved.bestDay === 'undefined') saved.bestDay = 0;
    if (saved.currentDate !== today) {
      if (saved.currentDate && saved.day) {
        saved.history[saved.currentDate] = {
          points: saved.day.todayPoints || 0,
          allOnTime: saved.day.allOnTime || false,
        };
        const yesterday = new Date(today + 'T12:00:00');
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];
        if (saved.day.celebrationShown) {
          saved.streak = (saved.history[yStr] || saved.day.celebrationShown) ? (saved.streak + 1) : 1;
        } else {
          saved.streak = 0;
        }
        if ((saved.day.todayPoints || 0) > saved.bestDay) saved.bestDay = saved.day.todayPoints;
      }
      saved.currentDate = today;
      saved.day = defaultDayState();
    }
    state = saved;
  } else {
    state = {
      pin: DEFAULT_PIN, startTime: DEFAULT_START, muted: false,
      allTimeTotal: 0, streak: 0, bestDay: 0, history: {},
      currentDate: today, day: defaultDayState(),
    };
  }
  saveState();
}

function getHeroTaskIndex() {
  const startMins = timeStrToMinutes(state.startTime);
  const nowMins = nowMinutes();
  for (let i = 0; i < TASK_DEFS.length; i++) {
    const { endMins } = taskWindows(TASK_DEFS[i], startMins);
    if (nowMins < endMins) return i;
  }
  return TASK_DEFS.length - 1;
}

function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  voicesLoaded = true;
  const preferred = ['Samantha', 'Karen', 'Moira', 'Fiona', 'Daniel', 'Alex'];
  for (const name of preferred) {
    const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (v) { selectedVoice = v; break; }
  }
  if (!selectedVoice) selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
}

speechSynthesis.addEventListener('voiceschanged', loadVoices);
loadVoices();

function unlockSpeech() {
  if (speechUnlocked) return;
  speechUnlocked = true;
  const utt = new SpeechSynthesisUtterance(' ');
  utt.volume = 0;
  speechSynthesis.speak(utt);
}

function speak(text, priority = false) {
  if (state.muted) return;
  if (!voicesLoaded) loadVoices();
  unlockSpeech();
  if (priority) speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.9; utt.pitch = 1.05; utt.volume = 1.0;
  if (selectedVoice) utt.voice = selectedVoice;
  speechSynthesis.speak(utt);
}

function speakCountdown() {
  if (state.muted) return;
  unlockSpeech();
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance('10, 9, 8, 7, 6, 5, 4, 3, 2, 1');
  utt.rate = 0.8; utt.pitch = 1.0; utt.volume = 1.0;
  if (selectedVoice) utt.voice = selectedVoice;
  speechSynthesis.speak(utt);
}

function tick() {
  const today = todayStr();
  if (state.currentDate !== today) { initState(); renderAll(); return; }

  const startMins = timeStrToMinutes(state.startTime);
  const nowMins = nowMinutes();
  const nowSecs = nowSeconds();
  const tasks = state.day.tasks;
  let stateChanged = false;

  for (let i = 0; i < TASK_DEFS.length; i++) {
    const def = TASK_DEFS[i];
    const task = tasks[i];
    const { startMins: tStart, endMins: tEnd } = taskWindows(def, startMins);
    const secsRemaining = (tEnd * 60) - nowSecs;

    if (task.status === 'approved') continue;

    if (nowMins >= tEnd && task.status !== 'expired' && task.status !== 'waiting') {
      task.status = 'expired';
      stateChanged = true;
    }

    if (i === getHeroTaskIndex() && task.status !== 'approved') {
      const audio = task.audioFired;
      const dur = def.endOff - def.startOff;
      if (dur > 3 && secsRemaining <= 180 && secsRemaining > 120 && !audio.min3) {
        audio.min3 = true; stateChanged = true;
        speak('3 minutes remaining Rufus', true);
      }
      if (dur > 2 && secsRemaining <= 120 && secsRemaining > 60 && !audio.min2) {
        audio.min2 = true; stateChanged = true;
        speak('2 minutes remaining Rufus', true);
      }
      if (secsRemaining <= 60 && secsRemaining > 30 && !audio.min1) {
        audio.min1 = true; stateChanged = true;
        speak('1 minute remaining Rufus', true);
      }
      if (secsRemaining <= 30 && secsRemaining > 10 && !audio.sec30) {
        audio.sec30 = true; stateChanged = true;
        speak('30 seconds remaining Rufus!', true);
      }
      if (secsRemaining <= 10 && secsRemaining > 0 && !audio.countdown) {
        audio.countdown = true; stateChanged = true;
        speakCountdown();
      }
      if (secsRemaining <= 0 && !audio.expired) {
        audio.expired = true; stateChanged = true;
        speak("Time's up! Moving to the next task.", true);
      }
    }
  }

  if (stateChanged) saveState();
  updateHeroUI();
  updateTaskCards();
  updateHeaderUI();
}

function renderAll() {
  renderTaskList();
  updateHeroUI();
  updateTaskCards();
  updateHeaderUI();
  updateStatsBar();
}

function updateHeaderUI() {
  const d = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('current-date-display').textContent =
    `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  const s = String(d.getSeconds()).padStart(2,'0');
  document.getElementById('current-time-display').textContent = `${h}:${m}:${s}`;
  document.getElementById('all-time-total').textContent = state.allTimeTotal;
  document.getElementById('mute-btn').textContent = state.muted ? '🔇' : '🔊';
}

function updateStatsBar() {
  document.getElementById('today-points').textContent = state.day.todayPoints;
  document.getElementById('streak-count').textContent = state.streak;
  document.getElementById('best-day-pts').textContent = state.bestDay;
}

function updateHeroUI() {
  const heroIdx = getHeroTaskIndex();
  const def = TASK_DEFS[heroIdx];
  const task = state.day.tasks[heroIdx];
  const startMins = timeStrToMinutes(state.startTime);
  const secsRem = taskSecsRemaining(def, startMins);
  const nameEl = document.getElementById('hero-task-name');
  const timerEl = document.getElementById('hero-timer');
  const statusEl = document.getElementById('hero-status-text');
  const labelEl = document.getElementById('hero-label');

  const allApproved = state.day.tasks.every(t => t.status === 'approved');
  if (allApproved) {
    labelEl.textContent = '🏆 All Done!';
    nameEl.textContent = 'Amazing work today!';
    timerEl.textContent = '00:00';
    timerEl.className = 'green';
    statusEl.textContent = `You earned ${state.day.todayPoints} points today! ⭐`;
    return;
  }

  labelEl.textContent = 'Current Task';
  nameEl.textContent = `${def.emoji} ${def.name}`;

  if (task.status === 'approved') {
    timerEl.textContent = '✓ Done';
    timerEl.className = 'green';
    timerEl.style.fontSize = '52px';
    statusEl.textContent = `+${task.pointsEarned} pts earned`;
  } else if (task.status === 'waiting') {
    timerEl.textContent = '⏳';
    timerEl.className = 'amber';
    timerEl.style.fontSize = '52px';
    statusEl.textContent = 'Waiting for parent approval...';
  } else if (secsRem > 0) {
    timerEl.style.fontSize = '';
    timerEl.textContent = formatSecondsMMSS(secsRem);
    if (secsRem > 180) {
      timerEl.className = 'green';
      statusEl.textContent = '✅ You have time — go go go!';
    } else if (secsRem > 60) {
      timerEl.className = 'amber';
      statusEl.textContent = '⚡ Hurry up Rufus!';
    } else {
      timerEl.className = 'red';
      statusEl.textContent = '🚨 Almost out of time!';
    }
  } else {
    timerEl.style.fontSize = '';
    timerEl.textContent = '00:00';
    timerEl.className = 'red';
    statusEl.textContent = '⏰ Time expired — still tap when done for half points!';
  }
}

function renderTaskList() {
  const container = document.getElementById('task-list');
  container.innerHTML = '';
  const startMins = timeStrToMinutes(state.startTime);
  TASK_DEFS.forEach((def, i) => {
    const { startMins: tStart, endMins: tEnd } = taskWindows(def, startMins);
    const card = document.createElement('div');
    card.className = 'task-card';
    card.id = `task-card-${i}`;
    card.setAttribute('role', 'listitem');
    const windowStr = `${formatTime(minsToStr(tStart))} – ${formatTime(minsToStr(tEnd))}`;
    card.innerHTML = `
      <button class="task-checkbox" id="checkbox-${i}" aria-label="Mark ${def.name} complete">
        ${def.emoji}
      </button>
      <div class="task-card-body">
        <div class="task-header-row">
          <span class="task-name">${def.name}</span>
          <span class="task-countdown" id="countdown-${i}">--:--</span>
        </div>
        <div class="task-meta-row">
          <span class="task-window">${windowStr}</span>
          <span class="task-status-pill" id="pill-${i}">Upcoming</span>
        </div>
        <div id="extra-row-${i}"></div>
      </div>
    `;
    container.appendChild(card);
    document.getElementById(`checkbox-${i}`).addEventListener('click', () => {
      unlockSpeech();
      onTaskCheckboxTap(i);
    });
  });
}

function updateTaskCards() {
  const startMins = timeStrToMinutes(state.startTime);
  const heroIdx = getHeroTaskIndex();
  const nowMins = nowMinutes();
  const nowSecs = nowSeconds();

  TASK_DEFS.forEach((def, i) => {
    const task = state.day.tasks[i];
    const card = document.getElementById(`task-card-${i}`);
    const pill = document.getElementById(`pill-${i}`);
    const cdEl = document.getElementById(`countdown-${i}`);
    const exEl = document.getElementById(`extra-row-${i}`);
    const cbEl = document.getElementById(`checkbox-${i}`);
    if (!card) return;

    const { startMins: tStart, endMins: tEnd } = taskWindows(def, startMins);
    const secsRem = (tEnd * 60) - nowSecs;
    card.classList.remove('active','status-green','status-amber','status-red','status-approved');

    if (task.status === 'approved') {
      card.classList.add('status-approved');
      cbEl.className = 'task-checkbox checked';
      cbEl.textContent = '✓';
      cdEl.textContent = `+${task.pointsEarned}pts`;
      cdEl.className = 'task-countdown green';
      pill.textContent = 'Approved ✓';
      pill.className = 'task-status-pill pill-approved';
      exEl.innerHTML = `<div class="task-points-earned">+${task.pointsEarned} points ${task.wasOnTime ? '(on time! 🌟)' : '(late)'}</div>`;
    } else if (task.status === 'waiting') {
      card.classList.add('status-amber');
      cbEl.className = 'task-checkbox checked';
      cbEl.textContent = '⏳';
      cdEl.textContent = secsRem > 0 ? formatSecondsMMSS(secsRem) : '00:00';
      cdEl.className = 'task-countdown amber';
      pill.textContent = 'Awaiting Approval';
      pill.className = 'task-status-pill pill-waiting';
      exEl.innerHTML = `
        <div class="task-approve-row">
          <span class="approve-label">Parent: tap to approve ↓</span>
          <button class="task-approve-btn" onclick="onApproveTask(${i})">Approve ✓</button>
        </div>`;
    } else if (task.status === 'expired') {
      card.classList.add('status-red');
      cbEl.className = 'task-checkbox';
      cbEl.textContent = def.emoji;
      cdEl.textContent = 'Expired';
      cdEl.className = 'task-countdown red';
      pill.textContent = 'Late — tap for half pts';
      pill.className = 'task-status-pill pill-expired';
      exEl.innerHTML = '';
    } else if (i === heroIdx && nowMins >= tStart) {
      card.classList.add('active');
      cbEl.className = 'task-checkbox';
      cbEl.textContent = def.emoji;
      if (secsRem > 0) {
        cdEl.textContent = formatSecondsMMSS(secsRem);
        if (secsRem > 180)     cdEl.className = 'task-countdown green';
        else if (secsRem > 60) cdEl.className = 'task-countdown amber';
        else                   cdEl.className = 'task-countdown red';
        card.classList.add(secsRem > 180 ? 'status-green' : secsRem > 60 ? 'status-amber' : 'status-red');
      } else {
        cdEl.textContent = '00:00';
        cdEl.className = 'task-countdown red';
      }
      pill.textContent = 'Active';
      pill.className = 'task-status-pill pill-active';
      exEl.innerHTML = '';
    } else if (nowMins < tStart) {
      cbEl.className = 'task-checkbox';
      cbEl.textContent = def.emoji;
      cdEl.textContent = '–';
      cdEl.className = 'task-countdown';
      pill.textContent = 'Upcoming';
      pill.className = 'task-status-pill pill-upcoming';
      exEl.innerHTML = '';
    } else {
      card.classList.add('status-red');
      cbEl.className = 'task-checkbox';
      cbEl.textContent = def.emoji;
      cdEl.textContent = 'Late';
      cdEl.className = 'task-countdown red';
      pill.textContent = 'Late — tap for half pts';
      pill.className = 'task-status-pill pill-expired';
      exEl.innerHTML = '';
    }
  });
}

function onTaskCheckboxTap(index) {
  const task = state.day.tasks[index];
  if (task.status === 'approved' || task.status === 'waiting') return;
  const def = TASK_DEFS[index];
  const startMins = timeStrToMinutes(state.startTime);
  const { startMins: tStart, endMins: tEnd } = taskWindows(def, startMins);
  const nowMins = nowMinutes();
  task.status = 'waiting';
  task.completedAt = Date.now();
  task.wasOnTime = (nowMins >= tStart && nowMins < tEnd);
  task.pointsEarned = null;
  speak(task.wasOnTime
    ? `Great job completing ${def.name} on time Rufus!`
    : `${def.name} done! Waiting for parent approval.`
  );
  saveState();
  const card = document.getElementById(`task-card-${index}`);
  if (card) {
    card.classList.add('just-completed');
    setTimeout(() => card.classList.remove('just-completed'), 600);
  }
  updateTaskCards();
  updateHeroUI();
}

function onApproveTask(index) {
  const task = state.day.tasks[index];
  if (task.status !== 'waiting') return;
  const def = TASK_DEFS[index];
  task.status = 'approved';
  task.pointsEarned = task.wasOnTime ? def.fullPts : def.halfPts;
  state.day.todayPoints += task.pointsEarned;
  state.allTimeTotal    += task.pointsEarned;
  saveState();
  speak(`Approved! ${task.pointsEarned} points for ${def.name}!`);
  updateTaskCards();
  updateHeroUI();
  updateHeaderUI();
  updateStatsBar();
  checkAllComplete();
}

function checkAllComplete() {
  const tasks = state.day.tasks;
  if (!tasks.every(t => t.status === 'approved')) return;
  if (state.day.celebrationShown) return;
  const allOnTime = tasks.every(t => t.wasOnTime === true);
  if (allOnTime) {
    state.day.todayPoints += PERFECT_BONUS;
    state.allTimeTotal    += PERFECT_BONUS;
    state.day.allOnTime   = true;
  }
  state.streak += 1;
  if (state.day.todayPoints > state.bestDay) state.bestDay = state.day.todayPoints;
  state.day.celebrationShown = true;
  saveState();
  setTimeout(() => showCelebration(allOnTime), 800);
}

function showCelebration(perfectBonus) {
  const overlay = document.getElementById('celebration-overlay');
  const ptsDisp = document.getElementById('celebration-points-display');
  const msgEl   = document.getElementById('celebration-message');
  overlay.classList.remove('hidden');
  const today = state.day.todayPoints;
  const total = state.allTimeTotal;
  ptsDisp.textContent = `+${today} pts`;
  msgEl.textContent = perfectBonus
    ? `Including a ${PERFECT_BONUS} point PERFECT BONUS! Your total is now ${total} points! 🌟`
    : `Your total is now ${total} points! Keep it up! 💪`;
  updateStatsBar();
  const msg = `Fantastic Rufus! You earned ${today} points today! Your total is now ${total} points!`
    + (perfectBonus ? ` And you get a perfect timing bonus of ${PERFECT_BONUS} extra points!` : '');
  setTimeout(() => speak(msg, true), 500);
  startConfetti();
}

document.getElementById('celebration-close-btn').addEventListener('click', () => {
  document.getElementById('celebration-overlay').classList.add('hidden');
  stopConfetti();
});

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#f472b6','#60a5fa','#34d399','#fbbf24','#a78bfa','#fb923c'];
  confettiParticles = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    r: Math.random() * 8 + 4,
    d: Math.random() * 150 + 50,
    color: colors[Math.floor(Math.random() * colors.length)],
    tilt: Math.random() * 10 - 5,
    tiltAngle: 0,
    tiltAngleDelta: (Math.random() * 0.12 + 0.04) * (Math.random() < 0.5 ? 1 : -1),
  }));
  let angle = 0;
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    angle += 0.01;
    confettiParticles.forEach(p => {
      p.tiltAngle += p.tiltAngleDelta;
      p.y += (Math.cos(angle + p.d) + 2.5);
      p.x += Math.sin(angle) * 0.8;
      p.tilt = Math.sin(p.tiltAngle) * 12;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
      if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
    });
    confettiAnim = requestAnimationFrame(frame);
  }
  confettiAnim = requestAnimationFrame(frame);
}

function stopConfetti() {
  if (confettiAnim) cancelAnimationFrame(confettiAnim);
  confettiAnim = null;
  confettiParticles = [];
  const canvas = document.getElementById('confetti-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

let pinBuffer = '';
let parentUnlocked = false;

document.getElementById('parent-btn').addEventListener('click', () => {
  unlockSpeech();
  openParentPanel();
});

function openParentPanel() {
  pinBuffer = '';
  parentUnlocked = false;
  document.getElementById('parent-overlay').classList.remove('hidden');
  document.getElementById('pin-screen').classList.remove('hidden');
  document.getElementById('parent-controls').classList.add('hidden');
  document.getElementById('pin-error').classList.add('hidden');
  updatePinDots();
}

document.getElementById('parent-close-btn').addEventListener('click', closeParentPanel);
document.getElementById('parent-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('parent-overlay')) closeParentPanel();
});

function closeParentPanel() {
  document.getElementById('parent-overlay').classList.add('hidden');
  pinBuffer = '';
  parentUnlocked = false;
}

document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pinBuffer.length >= 4) return;
    pinBuffer += btn.dataset.digit;
    updatePinDots();
    if (pinBuffer.length === 4) validatePin();
  });
});

document.getElementById('pin-clear-btn').addEventListener('click', () => {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
});

document.getElementById('pin-cancel-btn').addEventListener('click', closeParentPanel);

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`pd${i}`).classList.toggle('filled', i < pinBuffer.length);
  }
}

function validatePin() {
  if (pinBuffer === state.pin) {
    parentUnlocked = true;
    document.getElementById('pin-screen').classList.add('hidden');
    document.getElementById('parent-controls').classList.remove('hidden');
    populateParentControls();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
    pinBuffer = '';
    updatePinDots();
    setTimeout(() => document.getElementById('pin-error').classList.add('hidden'), 2000);
  }
}

function populateParentControls() {
  document.getElementById('ctrl-start-time').value = state.startTime;
  document.getElementById('ctrl-mute-toggle').checked = !state.muted;
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';
  const entries = Object.entries(state.history).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 14);
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:12px">No history yet</td></tr>';
  } else {
    entries.forEach(([date, data]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${dayOfWeek(date)} ${date}</td><td>${data.points}</td><td>${data.allOnTime ? '⭐ Yes' : 'No'}</td>`;
      tbody.appendChild(tr);
    });
  }
}

document.getElementById('ctrl-save-time').addEventListener('click', () => {
  const val = document.getElementById('ctrl-start-time').value;
  if (val) { state.startTime = val; saveState(); speak('Schedule updated!'); closeParentPanel(); renderAll(); }
});

document.getElementById('ctrl-mute-toggle').addEventListener('change', e => {
  state.muted = !e.target.checked;
  saveState();
  document.getElementById('mute-btn').textContent = state.muted ? '🔇' : '🔊';
});

document.getElementById('ctrl-test-audio').addEventListener('click', () => {
  speak("Hi Rufus! Your morning routine app is ready. Let's have a great day!", true);
});

document.getElementById('ctrl-points-save').addEventListener('click', () => {
  const val = parseInt(document.getElementById('ctrl-points-adj').value, 10);
  if (!isNaN(val) && val >= 0) { state.allTimeTotal = val; saveState(); updateHeaderUI(); speak(`Total points set to ${val}`); }
});

document.getElementById('ctrl-pin-save').addEventListener('click', () => {
  const val = String(document.getElementById('ctrl-new-pin').value).trim();
  if (val.length === 4 && /^\d{4}$/.test(val)) { state.pin = val; saveState(); speak('PIN updated'); }
  else speak('Please enter a 4-digit PIN');
});

document.getElementById('ctrl-reset-today').addEventListener('click', () => {
  if (confirm("Reset today's tasks? This will clear today's points too.")) {
    state.allTimeTotal = Math.max(0, state.allTimeTotal - state.day.todayPoints);
    state.day = defaultDayState();
    saveState(); closeParentPanel(); renderAll();
  }
});

document.getElementById('ctrl-reset-all').addEventListener('click', () => {
  if (confirm('Reset ALL data including history and total points? This cannot be undone!')) {
    localStorage.removeItem(STORAGE_KEY);
    initState(); closeParentPanel(); renderAll();
  }
});

document.getElementById('mute-btn').addEventListener('click', () => {
  unlockSpeech();
  state.muted = !state.muted;
  saveState();
  document.getElementById('mute-btn').textContent = state.muted ? '🔇' : '🔊';
  if (!state.muted) speak('Audio on!');
});

function init() {
  initState();
  renderAll();
  tickInterval = setInterval(() => { tick(); updateStatsBar(); }, 1000);
  window.onApproveTask = onApproveTask;
}

document.addEventListener('touchstart', unlockSpeech, { once: true, passive: true });
document.addEventListener('click', unlockSpeech, { once: true });

init();
