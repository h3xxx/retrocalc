/* RetroCalc: chat-like terminal calculator with a safe evaluator */
(function() {
  const chat = document.getElementById('chat');
  const form = document.getElementById('inputForm');
  const input = document.getElementById('prompt');

  // Cookie utilities for persisting user preferences
  function setCookie(name, value, days) {
    try {
      const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function getCookie(name) {
    const pattern = new RegExp('(?:^|; )' + name.replace(/[-\[\]\/{}()*+?.\\^$|]/g, '\\$&') + '=([^;]*)');
    const match = document.cookie.match(pattern);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Initialize preferences from cookies (fallback to legacy localStorage for theme)
  const cookieTheme = getCookie('retrocalc.theme');
  const legacyTheme = localStorage.getItem('retrocalc.theme');
  const initialTheme = cookieTheme || legacyTheme || 'green';
  const glitchCookie = getCookie('retrocalc.glitch');
  const initialGlitch = glitchCookie ? (glitchCookie === 'on') : true;
  const scanCookie = getCookie('retrocalc.scan');
  const initialScan = scanCookie ? (scanCookie === 'on') : true;

  const state = {
    history: [],
    historyIndex: -1,
    glitchEnabled: initialGlitch,
    scanEnabled: initialScan,
    theme: initialTheme,
  };

  const helpText = [
    'RetroCalc — commands:',
    '  • help       — show this message',
    '  • clear      — clear screen',
    '  • glitch on  — enable visual glitches',
    '  • glitch off — disable visual glitches',
    '  • scan on    — enable scan sweep',
    '  • scan off   — disable scan sweep',
    '',
    'Math:',
    '  Operators: +  -  *  /  ^  ( )',
    '  Notes: ^ is exponent and is right-associative; unary minus is supported.',
    '  Constants: pi ≈ 3.14159, e ≈ 2.71828',
    '',
    'Examples:',
    '  2*(3+4)^2               → 98',
    '  3^3^2                   → 3^(3^2) = 3^9 = 19683',
    '  -4*(2+pi)               → negative times parentheses',
    '  (2.5+0.5)*8/5           → decimals and precedence',
    '  (1+2+3+4)/4             → average of 1..4',
    '  2^(-3)                  → 0.125 (negative exponent)',
    '  (2^3)^2 vs 2^(3^2)     → 64 vs 512 (associativity)',
    '  10/(2*(3-1))            → nested parentheses',
    '  2*pi*3                  → circle circumference for r=3',
    '  e^(1)                   → Euler\'s number',
    '  (3 + -2) * 5            → unary minus in the middle',
    '',
    'Plotting:',
    '  Use x as the variable. Forms accepted:',
    '    plot y=2*x+1',
    '    y=0.5*x^2 - 3',
    '    28*x+4',
    '  Try: plot y=28*x+4',
    '  Range: x ∈ [-10, 10], adjust coming soon.',
    '',
    'Theme:',
    '  theme green  — green phosphor (default)',
    '  theme amber  — amber phosphor'
  ].join('\n');

  function appendMessage(role, text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg';

    const roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.textContent = role === 'user' ? 'you' : 'calc';

    const textEl = document.createElement('div');
    textEl.className = 'text';
    textEl.textContent = text;

    wrapper.appendChild(roleEl);
    wrapper.appendChild(textEl);
    chat.appendChild(wrapper);
    chat.scrollTop = chat.scrollHeight;
  }

  function applyTheme(theme) {
    state.theme = theme;
    const root = document.documentElement;
    if (theme === 'amber') {
      root.setAttribute('data-theme', 'amber');
    } else {
      root.removeAttribute('data-theme');
    }
    localStorage.setItem('retrocalc.theme', theme);
    setCookie('retrocalc.theme', theme, 365);
  }

  function clearChat() {
    chat.innerHTML = '';
  }

  // Tokenizer
  function tokenize(expr) {
    const tokens = [];
    const regex = /\s*([0-9]*\.?[0-9]+|pi|e|x|\^|\+|\-|\*|\/|\(|\))/y;
    let match;
    let idx = 0;
    while (idx < expr.length) {
      regex.lastIndex = idx;
      match = regex.exec(expr);
      if (!match) {
        const ch = expr[idx];
        throw new Error(`Unexpected character: ${ch}`);
      }
      const t = match[1];
      tokens.push(t);
      idx = regex.lastIndex;
    }
    return tokens;
  }

  // Shunting-yard to RPN
  function toRPN(tokens) {
    const output = [];
    const ops = [];

    function isNumber(t) { return /^(?:[0-9]*\.?[0-9]+|pi|e|x)$/.test(t); }
    function precedence(op) {
      switch (op) {
        case 'u-': return 4; // unary minus
        case '^': return 3;
        case '*': case '/': return 2;
        case '+': case '-': return 1;
        default: return 0;
      }
    }
    function isRightAssociative(op) { return op === '^' || op === 'u-'; }

    let prevToken = null;
    for (let i = 0; i < tokens.length; i++) {
      let t = tokens[i];
      if (isNumber(t)) {
        output.push(t);
      } else if (t === '(') {
        ops.push(t);
      } else if (t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push(ops.pop());
        }
        if (!ops.length) throw new Error('Mismatched parentheses');
        ops.pop(); // remove '('
      } else { // operator + - * / ^ or unary -
        if (t === '-' && (prevToken === null || (['(', '+', '-', '*', '/', '^'].includes(prevToken)))) {
          t = 'u-';
        }
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top === '(') break;
          const pTop = precedence(top);
          const pT = precedence(t);
          if ((isRightAssociative(t) && pT < pTop) || (!isRightAssociative(t) && pT <= pTop)) {
            output.push(ops.pop());
          } else {
            break;
          }
        }
        ops.push(t);
      }
      prevToken = t;
    }
    while (ops.length) {
      const op = ops.pop();
      if (op === '(' || op === ')') throw new Error('Mismatched parentheses');
      output.push(op);
    }
    return output;
  }

  // Evaluate RPN safely
  function evalRPN(rpn, scope) {
    const stack = [];
    for (const t of rpn) {
      if (/^(?:[0-9]*\.?[0-9]+|pi|e|x)$/.test(t)) {
        const v = (t === 'pi') ? Math.PI : (t === 'e') ? Math.E : (t === 'x' ? (scope && typeof scope.x === 'number' ? scope.x : NaN) : parseFloat(t));
        stack.push(v);
        continue;
      }
      if (t === 'u-') {
        if (stack.length < 1) throw new Error('Bad expression');
        const a = stack.pop();
        stack.push(-a);
        continue;
      }
      if (['+', '-', '*', '/', '^'].includes(t)) {
        if (stack.length < 2) throw new Error('Bad expression');
        const b = stack.pop();
        const a = stack.pop();
        let r;
        switch (t) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/': r = b === 0 ? NaN : a / b; break;
          case '^': r = Math.pow(a, b); break;
        }
        stack.push(r);
        continue;
      }
      throw new Error('Unknown token in RPN');
    }
    if (stack.length !== 1) throw new Error('Bad expression');
    return stack[0];
  }

  function evaluateExpression(expr, scope) {
    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    const value = evalRPN(rpn, scope);
    return value;
  }

  // Plotting utilities
  function parsePlotInput(text) {
    // Accept: "plot y=...", "plot ...", or "y=..." or just an expression using x
    const trimmed = text.trim();
    let expr = trimmed;
    if (/^plot\s+/i.test(expr)) expr = expr.replace(/^plot\s+/i, '');
    if (/^y\s*=\s*/i.test(expr)) expr = expr.replace(/^y\s*=\s*/i, '');
    // quick validation: must contain 'x' to be a function of x
    if (!/[\(\)x\d\+\-\*\/\^\.pie]/i.test(expr) || !/x/i.test(expr)) return null;
    return expr;
  }

  function renderPlot(expr, options) {
    const cfg = Object.assign({
      width: 640,
      height: 280,
      xMin: -10,
      xMax: 10,
      gridStep: 1,
      stroke: '#9cff9c',
      grid: 'rgba(102, 204, 102, 0.18)',
      axis: 'rgba(102, 204, 102, 0.6)',
    }, options || {});

    const container = document.createElement('div');
    container.className = 'msg';

    const roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.textContent = 'calc';

    const textEl = document.createElement('div');
    textEl.className = 'text';

    const card = document.createElement('div');
    card.className = 'plot-card';
    const title = document.createElement('p');
    title.className = 'plot-title';
    title.textContent = `plot y = ${expr}`;
    const wrap = document.createElement('div');
    wrap.className = 'plot-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'plot-canvas';
    canvas.width = cfg.width;
    canvas.height = cfg.height;
    wrap.appendChild(canvas);
    card.appendChild(title);
    card.appendChild(wrap);
    textEl.appendChild(card);

    container.appendChild(roleEl);
    container.appendChild(textEl);
    chat.appendChild(container);
    chat.scrollTop = chat.scrollHeight;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    // upscale for sharpness
    canvas.width = cfg.width * dpr;
    canvas.height = cfg.height * dpr;
    canvas.style.width = cfg.width + 'px';
    canvas.style.height = cfg.height + 'px';
    ctx.scale(dpr, dpr);

    // Clear background with subtle CRT tint
    ctx.fillStyle = 'rgba(8,12,8,0.75)';
    ctx.fillRect(0, 0, cfg.width, cfg.height);

    // Coordinate transforms
    const xRange = cfg.xMax - cfg.xMin;
    const yMin = -((cfg.height / cfg.width) * xRange) / 2;
    const yMax = -yMin;
    function xToPx(x) { return (x - cfg.xMin) * cfg.width / xRange; }
    function yToPx(y) { return cfg.height - ((y - yMin) * cfg.height / (yMax - yMin)); }

    // Grid
    ctx.strokeStyle = cfg.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(cfg.xMin); gx <= Math.floor(cfg.xMax); gx += cfg.gridStep) {
      const px = Math.round(xToPx(gx)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cfg.height);
    }
    for (let gy = Math.ceil(yMin); gy <= Math.floor(yMax); gy += cfg.gridStep) {
      const py = Math.round(yToPx(gy)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(cfg.width, py);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = cfg.axis;
    ctx.beginPath();
    // y-axis at x=0
    if (cfg.xMin <= 0 && cfg.xMax >= 0) {
      const x0 = Math.round(xToPx(0)) + 0.5;
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, cfg.height);
    }
    // x-axis at y=0
    if (yMin <= 0 && yMax >= 0) {
      const y0 = Math.round(yToPx(0)) + 0.5;
      ctx.moveTo(0, y0);
      ctx.lineTo(cfg.width, y0);
    }
    ctx.stroke();

    // Plot curve
    ctx.strokeStyle = cfg.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const samples = cfg.width; // one per pixel
    let first = true;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const x = cfg.xMin + t * xRange;
      let y = evaluateExpression(expr, { x });
      if (!isFinite(y)) { first = true; continue; }
      const px = xToPx(x);
      const py = yToPx(y);
      if (first) { ctx.moveTo(px, py); first = false; }
      else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    // Glow overlay
    ctx.strokeStyle = 'rgba(54,255,54,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function handleCommand(cmd) {
    const c = cmd.trim().toLowerCase();
    if (c === 'help' || c === '?') return helpText;
    if (c === 'clear' || c === 'cls') { clearChat(); return null; }
    if (c === 'glitch on') { state.glitchEnabled = true; setCookie('retrocalc.glitch', 'on', 365); return 'Glitch: ON'; }
    if (c === 'glitch off') { state.glitchEnabled = false; setCookie('retrocalc.glitch', 'off', 365); document.body.classList.remove('glitch-on'); return 'Glitch: OFF'; }
    if (c === 'scan on') { state.scanEnabled = true; setCookie('retrocalc.scan', 'on', 365); document.body.classList.remove('scan-off'); return 'Scan sweep: ON'; }
    if (c === 'scan off') { state.scanEnabled = false; setCookie('retrocalc.scan', 'off', 365); document.body.classList.add('scan-off'); return 'Scan sweep: OFF'; }
    if (c === 'theme amber') { applyTheme('amber'); return 'Theme: AMBER'; }
    if (c === 'theme green') { applyTheme('green'); return 'Theme: GREEN'; }
    if (c.startsWith('plot ') || /^y\s*=/.test(c) || /x/.test(c)) {
      const expr = parsePlotInput(cmd);
      if (!expr) return 'Plot usage: plot y=2*x+1  |  y=sin(x)  |  2*x^2+1';
      try {
        // probe to validate
        const test = evaluateExpression(expr, { x: 0 });
        if (!isFinite(test)) throw new Error('Invalid function');
        renderPlot(expr);
        return null;
      } catch (e) {
        return `Error plotting: ${(e && e.message) || 'Invalid function'}`;
      }
    }
    return undefined;
  }

  function onSubmit(text) {
    if (!text.trim()) return;
    appendMessage('user', text);

    const commandResult = handleCommand(text);
    if (commandResult === null) return; // cleared
    if (typeof commandResult === 'string') {
      appendMessage('assistant', commandResult);
      return;
    }

    try {
      const result = evaluateExpression(text);
      const out = Number.isNaN(result) ? 'NaN' : result.toString();
      appendMessage('assistant', out);
    } catch (err) {
      appendMessage('assistant', `Error: ${(err && err.message) || 'Invalid expression'}`);
    }
  }

  // Initial greeting
  appendMessage('assistant', 'RETROCALC READY. Type an expression or `help`.');
  appendMessage('assistant', 'Commands: help, clear, glitch on/off, scan on/off');
  appendMessage('assistant', 'Theme: theme green | theme amber');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    state.history.push(text);
    state.historyIndex = state.history.length;
    onSubmit(text);
    input.value = '';
  });

  // History navigation
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (state.historyIndex > 0) {
        state.historyIndex--;
        input.value = state.history[state.historyIndex] || '';
        e.preventDefault();
      }
    } else if (e.key === 'ArrowDown') {
      if (state.historyIndex < state.history.length) {
        state.historyIndex++;
        input.value = state.history[state.historyIndex] || '';
        e.preventDefault();
      }
    }
  });

  // Periodic glitch toggler (low probability, short bursts)
  (function setupGlitchScheduler(){
    const MIN_DELAY_MS = 2500;
    const MAX_DELAY_MS = 6000;
    function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function schedule() {
      const wait = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
      setTimeout(() => {
        if (state.glitchEnabled && Math.random() < 0.18) {
          document.body.classList.add('glitch-on');
          setTimeout(() => document.body.classList.remove('glitch-on'), 260);
        }
        schedule();
      }, wait);
    }
    schedule();
  })();

  // Apply saved theme on load
  applyTheme(state.theme);
  if (!state.glitchEnabled) {
    document.body.classList.remove('glitch-on');
  }
  if (!state.scanEnabled) {
    document.body.classList.add('scan-off');
  }
})();


