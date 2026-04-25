/**
 * ToIcey v5.0 (Cold & Fast)
 * Educational purposes only.
 */

(function() {
    'use strict';

    console.log('[Bot] Loading script...');

    const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
    let engine = null;
    let boardElement = null;
    let isAnalyzing = false;
    let isAutoPlay = false;
    let isTurbo = true;
    let lastFEN = '';
    window.lastAnalysisTime = Date.now();

    const PIECE_MAP = {
        'wp': 'P', 'wr': 'R', 'wn': 'N', 'wb': 'B', 'wq': 'Q', 'wk': 'K',
        'bp': 'p', 'br': 'r', 'bn': 'n', 'bb': 'b', 'bq': 'q', 'bk': 'k'
    };

    function initEngine() {
        try {
            console.log('[Bot] Initializing Stockfish...');
            const blob = new Blob([`importScripts("${STOCKFISH_URL}");`], {type: 'application/javascript'});
            engine = new Worker(URL.createObjectURL(blob));
            
            engine.onmessage = function(e) {
                const msg = e.data;
                if (msg.startsWith('bestmove')) {
                    const move = msg.split(' ')[1];
                    highlightMove(move);
                    isAnalyzing = false;
                }
                if (msg === 'readyok') updateStatus('Engine Ready');
            };

            engine.onerror = (e) => updateStatus('Engine Error');
            
            engine.postMessage('uci');
            engine.postMessage('setoption name Skill Level value 20');
            engine.postMessage('setoption name Threads value 2');
            engine.postMessage('isready');
        } catch (err) {
            updateStatus('Init Failed');
        }
    }

    function getActiveColor() {
        // 1. Primary: Check which clock is actually running
        const activeClock = document.querySelector('.clock-component.running, .clock-bottom.running, .clock-top.running, .clock-player-active');
        if (activeClock) {
            const isBottom = activeClock.closest('.clock-bottom, .bottom, [class*="player-info-bottom"]');
            const isFlipped = boardElement && boardElement.classList.contains('flipped');
            
            if (isBottom) return isFlipped ? 'b' : 'w';
            return isFlipped ? 'w' : 'b';
        }

        // 2. Secondary: Check turn indicator classes
        if (document.querySelector('.player-info.white.active, .player-white.active')) return 'w';
        if (document.querySelector('.player-info.black.active, .player-black.active')) return 'b';

        // 3. Fallback: Check FEN state (use turn from move list)
        const moves = document.querySelectorAll('div[data-ply], .move .node, .move-list-item');
        if (moves.length > 0) {
            const lastPly = moves[moves.length - 1].getAttribute('data-ply');
            if (lastPly) return (parseInt(lastPly) + 1) % 2 === 0 ? 'b' : 'w';
            return moves.length % 2 === 0 ? 'w' : 'b';
        }

        return 'w';
    }

    function getFEN() {
        const board = Array(8).fill(null).map(() => Array(8).fill(null));
        const pieces = document.querySelectorAll('.piece');
        if (pieces.length === 0) return null;

        pieces.forEach(el => {
            const classes = el.className.split(' ');
            let type = '', sq = '';
            classes.forEach(c => {
                if (PIECE_MAP[c]) type = PIECE_MAP[c];
                if (c.startsWith('square-')) sq = c.split('-')[1];
            });
            if (type && sq) {
                let col, row;
                if (isNaN(sq[0])) { // Algebraic (e2)
                    col = sq.charCodeAt(0) - 97;
                    row = 8 - parseInt(sq[1]);
                } else { // Numeric (52)
                    col = parseInt(sq[0]) - 1;
                    row = 8 - parseInt(sq[1]);
                }
                if (col >= 0 && col < 8 && row >= 0 && row < 8) board[row][col] = type;
            }
        });

        // Dynamic Castling Rights
        let castling = '';
        if (board[7][4] === 'K') {
            if (board[7][7] === 'R') castling += 'K';
            if (board[7][0] === 'R') castling += 'Q';
        }
        if (board[0][4] === 'k') {
            if (board[0][7] === 'r') castling += 'k';
            if (board[0][0] === 'r') castling += 'q';
        }
        if (!castling) castling = '-';

        // En Passant & Move Count
        let ep = '-';
        let moveCount = 1;
        const moveNodes = document.querySelectorAll('div[data-ply], .move .node, .move-list-item');
        if (moveNodes.length > 0) {
            moveCount = Math.floor(moveNodes.length / 2) + 1;
            const lastNode = moveNodes[moveNodes.length - 1];
            const lastMove = lastNode.innerText;
            // Precise EP detection: check if last move was a pawn double-push
            // Note: On chess.com, pawn moves are just the square (e.g., 'e4')
            if (lastMove.length === 2 && (lastMove[1] === '4' || lastMove[1] === '5')) {
                const file = lastMove[0];
                const col = file.charCodeAt(0) - 97;
                const row = lastMove[1] === '4' ? 4 : 3;
                // Verify there is a pawn at the destination
                if (board[row][col] && board[row][col].toLowerCase() === 'p') {
                    const rank = lastMove[1] === '4' ? '3' : '6';
                    ep = file + rank;
                }
            }
        }

        let fen = board.map(row => {
            let s = '', e = 0;
            row.forEach(p => { if (p) { if (e) s += e; s += p; e = 0; } else e++; });
            return e ? s + e : s;
        }).join('/');
        
        return `${fen} ${getActiveColor()} ${castling} ${ep} 0 ${moveCount}`;
    }

    function parseClock(el) {
        if (!el) return 0;
        const parts = el.innerText.split(':');
        if (parts.length === 2) return (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000;
        return parseFloat(parts[0]) * 1000;
    }

    function getClocks() {
        const w = document.querySelector('.player-info.white .clock-component span, .clock-bottom span, .clock-white span');
        const b = document.querySelector('.player-info.black .clock-component span, .clock-top span, .clock-black span');
        return { w: parseClock(w), b: parseClock(b) };
    }

    function startAnalysis(fen) {
        if (!engine) return;
        
        // Reset engine state for the new position
        engine.postMessage('stop');
        engine.postMessage('ucinewgame');
        
        lastFEN = fen;
        isAnalyzing = true;
        window.lastAnalysisTime = Date.now();
        updateStatus(isTurbo ? 'TURBO...' : 'THINKING...');
        
        engine.postMessage(`position fen ${fen}`);
        if (isTurbo) {
            engine.postMessage('go movetime 150');
        } else {
            const c = getClocks();
            if (c.w > 0 && c.b > 0) engine.postMessage(`go wtime ${c.w} btime ${c.b}`);
            else engine.postMessage('go depth 16');
        }
    }

    let lastTurn = '';

    function analyze(force = false) {
        const target = findBoard();
        if (!target) return updateStatus('No Board');
        if (boardElement !== target) return startObserving();

        const fen = getFEN();
        if (!fen) return updateStatus('No Pieces');
        
        const turn = fen.split(' ')[1];
        
        // Force analysis if it's a new turn or if explicitly forced
        if (turn !== lastTurn) {
            force = true;
            lastTurn = turn;
        }
        
        if (fen === lastFEN && !force) return;
        
        updateTurn(turn);
        
        if (isTurbo || force) {
            startAnalysis(fen);
        } else {
            clearTimeout(window.botScanT);
            window.botScanT = setTimeout(() => {
                const f = getFEN();
                if (f && (f !== lastFEN || force)) startAnalysis(f);
            }, 50);
        }
    }

    async function highlightMove(move) {
        updateBest(move);
        updateStatus('Idle');
        document.querySelectorAll('.bot-esp-highlight').forEach(el => el.remove());
        drawHighlight(move.substring(0, 2), 'bot-esp-src');
        drawHighlight(move.substring(2, 4), 'bot-esp-dest');
        
        if (isAutoPlay) {
            const turn = getActiveColor();
            const isFlipped = boardElement.classList.contains('flipped');
            const myColor = isFlipped ? 'b' : 'w';

            if (turn === myColor) {
                const delay = isTurbo ? 10 + Math.random() * 50 : 400 + Math.random() * 600;
                setTimeout(async () => { 
                    // Verify it is STILL our turn before moving
                    if (getActiveColor() === myColor) await doMove(move); 
                }, delay);
            } else {
                updateStatus('Opponent Thinking...');
            }
        }
    }

    function drawHighlight(sq, className) {
        if (!boardElement) return;
        const file = sq[0], rank = parseInt(sq[1]);
        
        // Robust flip detection: check for .flipped class or if '1' is at the top
        let isFlipped = boardElement.classList.contains('flipped');
        if (!isFlipped) {
            const coords = document.querySelector('.coordinates');
            if (coords && coords.innerText && coords.innerText.includes('1') && coords.style.top === '0px') isFlipped = true;
        }
        
        // Calculate percentages (0-7 for an 8x8 board)
        let colIndex = file.charCodeAt(0) - 97; // a=0, b=1...
        let rowIndex = 8 - rank; // 8=0, 7=1...

        if (isFlipped) {
            colIndex = 7 - colIndex;
            rowIndex = 7 - rowIndex;
        }

        const left = colIndex * 12.5;
        const top = rowIndex * 12.5;

        const h = document.createElement('div');
        h.className = `bot-esp-highlight ${className}`; // Use unique class name
        h.style.cssText = `
            pointer-events: none;
            z-index: 10;
            position: absolute;
            width: 12.5%;
            height: 12.5%;
            left: ${left}%;
            top: ${top}%;
            box-sizing: border-box;
            transition: all 0.2s ease;
        `;
        boardElement.appendChild(h);
    }

    async function doMove(move) {
        const from = move.substring(0, 2), to = move.substring(2, 4), promo = move[4];
        // Target specifically elements that represent pieces on the square
        const findSq = (s) => {
            const num = `${s.charCodeAt(0)-96}${s[1]}`;
            return boardElement.querySelector(`.piece.square-${num}, .piece.square-${s}, [class*="piece"][class*="square-${num}"], [class*="piece"][class*="square-${s}"]`) ||
                   boardElement.querySelector(`.square-${num}, .square-${s}`);
        };
        
        const fSq = findSq(from);
        const tSq = findSq(to) || boardElement; // Fallback to board for target if square div not found
        
        if (!fSq) return console.warn('[Bot] Could not find piece at', from);
        
        const fR = fSq.getBoundingClientRect(), tR = tSq.getBoundingClientRect();
        const fX = fR.left + fR.width/2, fY = fR.top + fR.height/2, tX = tR.left + tR.width/2, tY = tR.top + tR.height/2;
        
        const ev = (t, e, x, y) => {
            const p = { bubbles:true, cancelable:true, view:window, clientX:x, clientY:y, button:0, buttons:1, isPrimary:true, pointerId:1, pointerType:'mouse' };
            e.dispatchEvent(new PointerEvent(t, p)); e.dispatchEvent(new MouseEvent(t, p));
        };
        
        ev('pointerdown', fSq, fX, fY); ev('mousedown', fSq, fX, fY);
        await new Promise(r => setTimeout(r, 50));
        ev('pointermove', document.body, tX, tY); // Move over the body to ensure it registers
        await new Promise(r => setTimeout(r, 50));
        ev('pointerup', document.body, tX, tY); ev('mouseup', document.body, tX, tY);
        
        // Final click to confirm for some board versions
        const targetEl = document.elementFromPoint(tX, tY) || tSq;
        if (targetEl && typeof targetEl.click === 'function') targetEl.click();

        if (promo) {
            await new Promise(r => setTimeout(r, 250));
            const p = document.querySelector(`.promotion-piece.${promo}, .promotion-window [class*="${promo}"], [data-type="${promo}"]`);
            if (p) p.click();
        }
    }

    function findBoard() { 
        // Targeted search for the actual board grid container
        const board = document.querySelector('chess-board') || 
                      document.querySelector('wc-chess-board') || 
                      document.querySelector('.board') || 
                      document.querySelector('#board-layout-main .chess-board');
        if (board) board.style.position = 'relative'; // Ensure positioning context
        return board;
    }

    function startObserving() {
        const t = findBoard(); if (!t) { setTimeout(startObserving, 1000); return; }
        if (window.botObs) window.botObs.disconnect();
        boardElement = t; updateStatus('Ready');
        
        let throttle = false;
        window.botObs = new MutationObserver(() => {
            if (throttle) return;
            throttle = true;
            setTimeout(() => {
                analyze();
                throttle = false;
            }, 100); // 100ms throttle to prevent lag during animations
        });

        window.botObs.observe(t, { 
            childList: true, 
            subtree: true, 
            attributes: true, 
            attributeFilter: ['class'] // Ignore style changes to prevent lag
        });
        
        analyze();
    }

    function unload() {
        console.log('[Bot] Unloading...');
        if (window.botWatchdog) clearInterval(window.botWatchdog);
        if (window.botObs) window.botObs.disconnect();
        if (engine) engine.terminate();
        if (window.botScanT) clearTimeout(window.botScanT);
        document.querySelectorAll('.bot-highlight').forEach(el => el.remove());
        const ui = document.getElementById('bot-ui');
        if (ui) ui.remove();
        console.log('[Bot] Unloaded successfully.');
    }

    function createUI() {
        if (document.getElementById('bot-ui')) return;

        // Add Google Font and Animations
        if (!document.getElementById('bot-assets')) {
            const assets = document.createElement('div');
            assets.id = 'bot-assets';
            assets.innerHTML = `
                <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
                <style>
                    @keyframes bot-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                    @keyframes bot-glow { 0% { box-shadow: 0 0 5px rgba(0,255,242,0.2); } 50% { box-shadow: 0 0 20px rgba(0,255,242,0.4); } 100% { box-shadow: 0 0 5px rgba(0,255,242,0.2); } }
                    .bot-toggle { position: relative; width: 34px; height: 18px; background: #333; border-radius: 20px; cursor: pointer; transition: 0.3s; }
                    .bot-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; background: white; border-radius: 50%; transition: 0.3s; }
                    .bot-toggle.active { background: linear-gradient(90deg, #00C2FF, #00FFD1); }
                    .bot-toggle.active::after { left: 18px; }
                    .bot-btn { background: #1a1a1a; border: 1px solid #333; color: white; padding: 10px; cursor: pointer; border-radius: 12px; font-size: 12px; font-weight: 600; transition: 0.2s; font-family: 'Outfit', sans-serif; }
                    .bot-btn:hover { background: #252525; border-color: #00C2FF; transform: translateY(-1px); }
                    .bot-btn:active { transform: translateY(1px); }
                    @keyframes bot-esp-pulse { 0% { opacity: 0.6; } 50% { opacity: 1.0; } 100% { opacity: 0.6; } }
                    .bot-esp-src { border: 3px solid #00C2FF; background: rgba(0, 194, 255, 0.4); box-shadow: inset 0 0 20px rgba(0, 194, 255, 0.5), 0 0 15px rgba(0, 194, 255, 0.3); animation: bot-esp-pulse 2s infinite; }
                    .bot-esp-dest { border: 3px solid #00FFD1; background: rgba(0, 255, 209, 0.4); box-shadow: inset 0 0 20px rgba(0, 255, 209, 0.5), 0 0 15px rgba(0, 255, 209, 0.3); animation: bot-esp-pulse 2s infinite; }
                </style>
            `;
            document.head.appendChild(assets);
        }

        const ui = document.createElement('div');
        ui.id = 'bot-ui';
        ui.style.cssText = `
            position: fixed; top: 25px; right: 25px; width: 240px;
            background: rgba(10, 10, 10, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            color: white; padding: 22px; border-radius: 24px; z-index: 999999;
            font-family: 'Outfit', sans-serif; border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 20px 50px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.05);
            animation: bot-fade-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); user-select: none;
        `;

        ui.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:12px; height:12px; background:linear-gradient(45deg, #00C2FF, #00FFD1); border-radius:4px; transform:rotate(45deg); animation: bot-glow 2s infinite;"></div>
                    <span style="font-weight:700; font-size:16px; letter-spacing:-0.4px; background:linear-gradient(90deg, #fff, #999); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">ToIcey</span>
                </div>
                <span id="bot-close" style="color:#444; cursor:pointer; font-size:22px; transition:0.2s; font-weight:300;">&times;</span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:18px;">
                <div>
                    <div id="bot-status" style="font-size:10px; color:#666; text-transform:uppercase; letter-spacing:1.2px; margin-bottom:4px;">Engine Ready</div>
                    <div id="bot-turn" style="font-size:14px; font-weight:600; color:#ddd;">Turn: -</div>
                </div>
                <div style="font-size:10px; color:#555; font-family:'JetBrains Mono';">v5.0</div>
            </div>

            <div style="background:rgba(255,255,255,0.02); border-radius:18px; padding:18px; margin-bottom:20px; border:1px solid rgba(255,255,255,0.04); text-align:center; position:relative; overflow:hidden;">
                <div style="position:absolute; top:0; left:0; width:100%; height:2px; background:linear-gradient(90deg, transparent, #00C2FF, transparent);"></div>
                <div style="font-size:10px; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">Calculated Move</div>
                <div id="bot-move" style="font-size:36px; font-weight:700; color:white; font-family:'JetBrains Mono', monospace; letter-spacing:-1px;">-</div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:22px;">
                <div id="bot-toggle-auto" style="display:flex; flex-direction:column; align-items:center; gap:8px; background:rgba(255,255,255,0.02); padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,0.03); cursor:pointer;">
                    <div class="bot-toggle" id="toggle-auto"></div>
                    <span style="font-size:10px; font-weight:700; color:#666; text-transform:uppercase;">Auto</span>
                </div>
                <div id="bot-toggle-turbo" style="display:flex; flex-direction:column; align-items:center; gap:8px; background:rgba(255,255,255,0.02); padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,0.03); cursor:pointer;">
                    <div class="bot-toggle active" id="toggle-turbo"></div>
                    <span style="font-size:10px; font-weight:700; color:#666; text-transform:uppercase;">Turbo</span>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button id="bot-scan" class="bot-btn">RE-SCAN</button>
                <button id="bot-flip" class="bot-btn">FLIP SIDE</button>
            </div>
        `;

        document.body.appendChild(ui);

        const closeBtn = document.getElementById('bot-close');
        closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
        closeBtn.onmouseout = () => closeBtn.style.color = '#444';
        closeBtn.onclick = () => unload();

        // Custom Toggle Handlers
        const updateToggles = () => {
            document.getElementById('toggle-auto').className = `bot-toggle ${isAutoPlay ? 'active' : ''}`;
            document.getElementById('toggle-turbo').className = `bot-toggle ${isTurbo ? 'active' : ''}`;
        };

        document.getElementById('bot-toggle-auto').onclick = () => { isAutoPlay = !isAutoPlay; updateToggles(); if (isAutoPlay) analyze(); };
        document.getElementById('bot-toggle-turbo').onclick = () => { isTurbo = !isTurbo; updateToggles(); };

        document.getElementById('bot-scan').onclick = () => { lastFEN = ''; analyze(); };
        document.getElementById('bot-flip').onclick = () => {
            const c = getActiveColor() === 'w' ? 'b' : 'w', f = getFEN();
            if (f) { const p = f.split(' '); p[1] = c; startAnalysis(p.join(' ')); }
        };
    }

    function updateStatus(s) { const el = document.getElementById('bot-status'); if (el) el.innerText = s; }
    function updateTurn(c) { const el = document.getElementById('bot-turn'); if (el) { el.innerText = 'Turn: ' + (c === 'w' ? 'White' : 'Black'); el.style.color = c === 'w' ? '#fff' : '#aaa'; } }
    function updateBest(m) { const el = document.getElementById('bot-move'); if (el) el.innerText = m || '-'; }

    function watchdog() {
        let cycles = 0;
        window.botWatchdog = setInterval(() => {
            cycles++;
            // Every 5 seconds, clear the FEN cache to force a fresh re-scan
            if (cycles % 5 === 0) {
                lastFEN = '';
                lastTurn = '';
            }

            analyze();
            
            if (isAnalyzing && Date.now() - window.lastAnalysisTime > 15000) { 
                isAnalyzing = false; 
                analyze(true); 
            }
            if (!document.getElementById('bot-ui') && document.body) createUI();
        }, 1000);
    }

    if (document.body) createUI(); else window.addEventListener('load', createUI);
    initEngine();
    startObserving();
    watchdog();
    console.log('[Bot] Script fully initialized.');
})();
