const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const overlay = document.getElementById('overlay');
const msgDiv = document.getElementById('msg');
const joystickContainer = document.getElementById('joystick-container');
const joystickKnob = document.getElementById('joystick-knob');

let ball = { x: 50, y: 50, vx: 0, vy: 0, r: 12 };
let holes = [];
let target = { x: 0, y: 0, r: 18 };
let walls = [];
let tilt = { ax: 0, ay: 0 };
let gameState = 'ready'; // ready, playing, over
let hasGyro = false;
let gyroTimer = null;

// Scale to viewport
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (gameState === 'ready') {
        generateLevel();
    }
}
window.addEventListener('resize', resize);

function generateLevel() {
    holes = [];
    walls = [];
    
    // Start top-left
    ball.x = 40;
    ball.y = 40;
    ball.vx = 0;
    ball.vy = 0;
    
    // Target bottom-right
    target.x = canvas.width - 50;
    target.y = canvas.height - 50;

    // Generate random holes avoiding start and target areas
    const numHoles = Math.floor((canvas.width * canvas.height) / 15000); 
    let attempts = 0;
    while(holes.length < numHoles && attempts < 500) {
        let hx = 30 + Math.random() * (canvas.width - 60);
        let hy = 30 + Math.random() * (canvas.height - 60);
        
        // Distance to start and target
        let distStart = Math.hypot(hx - ball.x, hy - ball.y);
        let distTarget = Math.hypot(hx - target.x, hy - target.y);
        
        if (distStart > 80 && distTarget > 80) {
            // Check overlap with other holes
            let overlap = holes.some(h => Math.hypot(hx - h.x, hy - h.y) < h.r * 2.5);
            if (!overlap) {
                holes.push({ x: hx, y: hy, r: 15 + Math.random() * 10 });
            }
        }
        attempts++;
    }

    // Add a few inner walls
    const numWalls = Math.floor(canvas.width / 150);
    for (let i = 0; i < numWalls; i++) {
        let isHoriz = Math.random() > 0.5;
        let w = isHoriz ? 100 + Math.random() * 100 : 15;
        let h = isHoriz ? 15 : 100 + Math.random() * 100;
        let x = 50 + Math.random() * (canvas.width - w - 100);
        let y = 50 + Math.random() * (canvas.height - h - 100);
        walls.push({ x, y, w, h });
    }
}

// Request Device Orientation (iOS 13+ requirement)
function initGame() {
    overlay.style.display = 'none';
    gameState = 'playing';
    msgDiv.innerText = '';
    
    generateLevel();

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                    waitForGyro();
                } else {
                    enableJoystick();
                }
            })
            .catch(console.error);
    } else {
        window.addEventListener('deviceorientation', handleOrientation);
        waitForGyro();
    }
}

function waitForGyro() {
    // If no gyro data in 1 second, fallback to joystick
    gyroTimer = setTimeout(() => {
        if (!hasGyro) enableJoystick();
    }, 1000);
}

function handleOrientation(event) {
    if (event.beta !== null && event.gamma !== null) {
        hasGyro = true;
        // beta: front back (-180 to 180) -> map to ay
        // gamma: left right (-90 to 90) -> map to ax
        let maxTilt = 45;
        let gamma = Math.max(-maxTilt, Math.min(maxTilt, event.gamma));
        let beta = Math.max(-maxTilt, Math.min(maxTilt, event.beta));
        
        // Acceleration scaling
        tilt.ax = (gamma / maxTilt) * 0.8; 
        tilt.ay = (beta / maxTilt) * 0.8;
    }
}

function enableJoystick() {
    joystickContainer.style.display = 'block';
    
    let isDragging = false;
    let center = { x: 0, y: 0 };
    let maxR = 60; // 120 / 2

    const startDrag = (e) => {
        isDragging = true;
        let rect = joystickContainer.getBoundingClientRect();
        center.x = rect.left + maxR;
        center.y = rect.top + maxR;
        updateKnob(e);
        e.preventDefault();
    };

    const drag = (e) => {
        if (!isDragging) return;
        updateKnob(e);
        e.preventDefault();
    };

    const stopDrag = () => {
        isDragging = false;
        joystickKnob.style.transform = `translate(-50%, -50%)`;
        tilt.ax = 0;
        tilt.ay = 0;
    };

    const updateKnob = (e) => {
        let touch = e.touches ? e.touches[0] : e;
        let dx = touch.clientX - center.x;
        let dy = touch.clientY - center.y;
        let dist = Math.hypot(dx, dy);
        
        if (dist > maxR) {
            dx = (dx / dist) * maxR;
            dy = (dy / dist) * maxR;
        }

        joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        
        tilt.ax = (dx / maxR) * 0.6; // Slightly slower than max tilt
        tilt.ay = (dy / maxR) * 0.6;
    };

    joystickContainer.addEventListener('touchstart', startDrag, {passive: false});
    joystickContainer.addEventListener('touchmove', drag, {passive: false});
    joystickContainer.addEventListener('touchend', stopDrag);
    
    // Mouse fallback for desktop testing
    joystickContainer.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', drag);
    window.addEventListener('mouseup', stopDrag);
}

startBtn.addEventListener('click', initGame);

// Main Game Loop
let lastTime = performance.now();

function update(time) {
    let dt = (time - lastTime) / 16.66; // Normalize to 60fps
    lastTime = time;

    if (gameState === 'playing') {
        // Apply physics
        ball.vx += tilt.ax * dt;
        ball.vy += tilt.ay * dt;

        // Friction to observe inertia but not slide forever
        ball.vx *= 0.96;
        ball.vy *= 0.96;

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        let bounce = -0.5;

        // Wall collisions (outer)
        if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= bounce; }
        if (ball.x + ball.r > canvas.width) { ball.x = canvas.width - ball.r; ball.vx *= bounce; }
        if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= bounce; }
        if (ball.y + ball.r > canvas.height) { ball.y = canvas.height - ball.r; ball.vy *= bounce; }

        // Inner wall collisions (AABB vs Circle)
        walls.forEach(w => {
            // Find closest point on rect to circle center
            let testX = ball.x;
            let testY = ball.y;

            if (ball.x < w.x) testX = w.x; else if (ball.x > w.x + w.w) testX = w.x + w.w;
            if (ball.y < w.y) testY = w.y; else if (ball.y > w.y + w.h) testY = w.y + w.h;

            let distX = ball.x - testX;
            let distY = ball.y - testY;
            let distance = Math.hypot(distX, distY);

            if (distance <= ball.r) {
                // Collision! Calculate normal
                if (Math.abs(distX) > Math.abs(distY)) {
                    ball.vx *= bounce;
                    ball.x = ball.x < w.x ? w.x - ball.r : w.x + w.w + ball.r;
                } else {
                    ball.vy *= bounce;
                    ball.y = ball.y < w.y ? w.y - ball.r : w.y + w.h + ball.r;
                }
            }
        });

        // Hole check
        holes.forEach(h => {
            let dist = Math.hypot(ball.x - h.x, ball.y - h.y);
            // Fall in if center of ball goes deep enough into hole
            if (dist < h.r - 2) {
                gameState = 'over';
                msgDiv.innerHTML = "You fell in!<br><span style='font-size:1rem;cursor:pointer' onclick='initGame()'>Tap to retry</span>";
                ball.x = h.x;
                ball.y = h.y;
            }
        });

        // Target check
        let distTarget = Math.hypot(ball.x - target.x, ball.y - target.y);
        if (distTarget < target.r) {
            gameState = 'over';
            msgDiv.innerHTML = "You Won!<br><span style='font-size:1rem;cursor:pointer' onclick='initGame()'>Tap to play again</span>";
            ball.x = target.x;
            ball.y = target.y;
        }
    }

    draw();
    requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Holes
    holes.forEach(h => {
        let gradient = ctx.createRadialGradient(h.x, h.y, h.r * 0.2, h.x, h.y, h.r);
        gradient.addColorStop(0, '#000');
        gradient.addColorStop(0.8, '#111');
        gradient.addColorStop(1, '#422410'); // Wood edge shadow

        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#321908';
        ctx.stroke();
    });

    // Draw Target
    let tGrad = ctx.createRadialGradient(target.x, target.y, target.r * 0.1, target.x, target.y, target.r);
    tGrad.addColorStop(0, '#00ff00');
    tGrad.addColorStop(1, '#004400');
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
    ctx.fillStyle = tGrad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Draw Inner Walls
    ctx.fillStyle = '#654321';
    walls.forEach(w => {
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 2;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        
        // Add 3D-ish highlight/shadow to walls
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(w.x, w.y, w.w, 3); // top highlight
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(w.x, w.y + w.h - 3, w.w, 3); // bottom shadow
        ctx.fillStyle = '#654321'; // reset
    });

    // Draw Ball
    let bGrad = ctx.createRadialGradient(
        ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.1,
        ball.x, ball.y, ball.r
    );
    bGrad.addColorStop(0, '#fff');
    bGrad.addColorStop(0.5, '#aaa');
    bGrad.addColorStop(1, '#444');

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = bGrad;
    ctx.fill();
    
    // Add slight drop shadow for the ball
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.fill();
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// Start sequence
resize();
requestAnimationFrame(update);
