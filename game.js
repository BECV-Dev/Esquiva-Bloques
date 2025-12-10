const GAME_VERSION = "v0.2.2";
console.log("Esquiva los bloques –", GAME_VERSION);

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Mostrar versión en la UI
const versionTag = document.getElementById("versionTag");
if (versionTag) {
    versionTag.textContent = GAME_VERSION;
}

// --- PERF PROFILES ---
const QUALITY_HIGH = "high";
const QUALITY_MEDIUM = "medium";
const QUALITY_LOW = "low";

let qualityProfile = QUALITY_HIGH;

// --- DETECCIÓN TOUCH + PERF INICIAL ---
const isTouchDevice =
    ("ontouchstart" in window) ||
    (navigator.maxTouchPoints > 0) ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

// En móviles/tablets empezamos en calidad media por seguridad
if (isTouchDevice) {
    qualityProfile = QUALITY_LOW;
}

// Para medir FPS y bajar calidad si hace falta
let fpsSamples = [];
let lowFpsStrikes = 0;
const FPS_WINDOW = 45;          // nº de frames para promediar
const FPS_THRESHOLD = 45;       // si promedia por debajo → problema
const FPS_STRIKES_TO_LOWER = 3; // nº de veces seguidas con FPS bajos

function downgradeQualityProfile() {
    if (qualityProfile === QUALITY_HIGH) {
        qualityProfile = QUALITY_MEDIUM;
        console.log("Calidad reducida a MEDIUM por bajo FPS");
    } else if (qualityProfile === QUALITY_MEDIUM) {
        qualityProfile = QUALITY_LOW;
        console.log("Calidad reducida a LOW por bajo FPS");
    }
    // Si ya está en LOW no hacemos nada
}

// --- CONFIGURACIÓN DEL JUEGO ---
const player = {
    x: canvas.width / 2 - 25,
    y: canvas.height - 60,
    width: 50,
    height: 20,
    speed: 6
};

let obstacles = [];
let powerups = [];
let lastObstacleTime = 0;
let obstacleInterval = 900;
const BASE_OBSTACLE_INTERVAL = 900;
const MIN_OBSTACLE_INTERVAL = 400;

let powerupTimer = 0;
const POWERUP_INTERVAL = 8000;

let isGameOver = false;
let score = 0;
let bestScore = 0;
let lastTime = 0;
let gameState = "ready"; // "ready" | "playing" | "gameover"

const BEST_SCORE_KEY = "dodge_best_score_v1";

const keys = {
    ArrowLeft: false,
    ArrowRight: false
};

// --- DETECCIÓN TOUCH + CONTROLES MÓVILES ---
if (isTouchDevice) {
    document.body.classList.add("is-touch");

    const btnLeft = document.getElementById("btnLeft");
    const btnRight = document.getElementById("btnRight");
    const btnRestart = document.getElementById("btnRestart");
    const btnHardcore = document.getElementById("btnHardcore");

    const pressLeft = (e) => {
        e.preventDefault();
        keys.ArrowLeft = true;
        if (gameState === "ready") {
            restartGame();
        }
    };
    const releaseLeft = (e) => {
        e.preventDefault();
        keys.ArrowLeft = false;
    };

    const pressRight = (e) => {
        e.preventDefault();
        keys.ArrowRight = true;
        if (gameState === "ready") {
            restartGame();
        }
    };
    const releaseRight = (e) => {
        e.preventDefault();
        keys.ArrowRight = false;
    };

    // Botón táctil: Reiniciar / Empezar
    const handleTapRestart = (e) => {
        e.preventDefault();
        if (gameState === "ready" || gameState === "gameover") {
            restartGame();
        }
    };

    // Botón táctil: Hardcore
    const handleTapHardcore = (e) => {
        e.preventDefault();
        toggleHardcore();
    };

    // Botones táctiles (con null-check y passive: false)
    if (btnLeft) {
        btnLeft.addEventListener("touchstart", pressLeft, { passive: false });
        btnLeft.addEventListener("touchend", releaseLeft, { passive: false });
        btnLeft.addEventListener("touchcancel", releaseLeft, { passive: false });

        btnLeft.addEventListener("mousedown", pressLeft);
        btnLeft.addEventListener("mouseup", releaseLeft);
        btnLeft.addEventListener("mouseleave", releaseLeft);
    }

    if (btnRight) {
        btnRight.addEventListener("touchstart", pressRight, { passive: false });
        btnRight.addEventListener("touchend", releaseRight, { passive: false });
        btnRight.addEventListener("touchcancel", releaseRight, { passive: false });

        btnRight.addEventListener("mousedown", pressRight);
        btnRight.addEventListener("mouseup", releaseRight);
        btnRight.addEventListener("mouseleave", releaseRight);
    }

    if (btnRestart) {
        btnRestart.addEventListener("touchstart", handleTapRestart, { passive: false });
        btnRestart.addEventListener("mousedown", handleTapRestart);
    }

    if (btnHardcore) {
        btnHardcore.addEventListener("touchstart", handleTapHardcore, { passive: false });
        btnHardcore.addEventListener("mousedown", handleTapHardcore);
    }


    // Touch directo sobre canvas
    const handleCanvasTouch = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;

        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;

        const middle = rect.width / 2;
        const deadZone = rect.width * 0.1;

        // Arrancar partida si está en READY
        if (gameState === "ready") {
            restartGame();
        }

        keys.ArrowLeft = false;
        keys.ArrowRight = false;

        if (x < middle - deadZone) {
            keys.ArrowLeft = true;
        } else if (x > middle + deadZone) {
            keys.ArrowRight = true;
        }
    };


    const handleCanvasTouchEnd = (e) => {
        e.preventDefault();
        keys.ArrowLeft = false;
        keys.ArrowRight = false;
    };

    canvas.addEventListener("touchstart", handleCanvasTouch, { passive: false });
    canvas.addEventListener("touchmove", handleCanvasTouch, { passive: false });
    canvas.addEventListener("touchend", handleCanvasTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleCanvasTouchEnd, { passive: false });
}

// --- EFECTOS ---
let screenShake = 0;
const streaks = [];
const particles = [];
const playerTrail = [];
const comboTexts = [];

let combo = 0;
let bestCombo = 0;
let lastNearMissTime = 0;
const NEAR_MISS_DISTANCE = 50;

// Hit-stop / flash de impacto
let hitStopTimer = 0;   // ms de congelamiento
let hitFlashTimer = 0;  // ms de flash rojo

// Estrellas en capas (parallax simple)
const STAR_LAYERS_BASE = [
    { count: 40, speed: 0.08, radius: 1.0, alpha: 0.20 },
    { count: 30, speed: 0.16, radius: 1.4, alpha: 0.28 },
    { count: 20, speed: 0.28, radius: 2.0, alpha: 0.38 }
];

let starLayers = [];
let motionFieldOffset = 0; // motion field diagonal

function getStarCountForQuality(baseCount) {
    if (qualityProfile === QUALITY_HIGH) return baseCount;
    if (qualityProfile === QUALITY_MEDIUM) return Math.max(8, Math.round(baseCount * 0.7));
    return Math.max(6, Math.round(baseCount * 0.45)); // LOW
}

function initStars() {
    const width = canvas.width;
    const height = canvas.height;

    starLayers = STAR_LAYERS_BASE.map(layerConf => {
        const count = getStarCountForQuality(layerConf.count);
        const stars = [];
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height
            });
        }
        return {
            ...layerConf,
            count,
            stars
        };
    });
}

let slowMotionActive = false;
let slowMotionTimer = 0;

let shieldActive = false;
let shieldTimer = 0;

let hardcoreActive = false;

// Niveles
let level = 1;
const LEVEL_UP_SCORE = 400;
let nextLevelScore = LEVEL_UP_SCORE;
let levelUpFlashTimer = 0;

// --- SONIDOS ---
const sfxNearMiss = new Audio("./Sounds/sfx_near_miss.mp3");
sfxNearMiss.volume = 0.4;

const sfxGameOver = new Audio("./Sounds/sfx_game_over.mp3");
sfxGameOver.volume = 0.6;

const sfxBlockPass = new Audio("./Sounds/sfx_blip.mp3");
sfxBlockPass.volume = 0.3;

const sfxPowerup = new Audio("./Sounds/sfx_powerup.mp3");
sfxPowerup.volume = 0.5;

const sfxShieldHit = new Audio("./Sounds/sfx_shield_hit.mp3");
sfxShieldHit.volume = 0.5;

const sfxShieldHum = new Audio("./Sounds/sfx_shield_hum.mp3");
sfxShieldHum.volume = 0.18;
sfxShieldHum.loop = true;

// SFX nivel subido
const sfxLevelUp = new Audio("./Sounds/sfx_level_up.mp3");
sfxLevelUp.volume = 0.5;

// --- MÚSICA ---
let musicNormal = new Audio("./Music/track_normal.mp3");
let musicHardcore = new Audio("./Music/track_hardcore.mp3");

musicNormal.loop = true;
musicHardcore.loop = true;

// Volúmenes recomendados (no estorban SFX)
musicNormal.volume = 0.22;
musicHardcore.volume = 0.26;

// Helper de SFX: clona el audio para evitar cortes entre sonidos
function playSfx(audio, {
    volume = null,
    pitchMin = 0.96,
    pitchMax = 1.04
} = {}) {
    try {
        const clone = audio.cloneNode();
        clone.volume = (volume !== null) ? volume : audio.volume;
        const randPitch = pitchMin + Math.random() * (pitchMax - pitchMin);
        clone.playbackRate = randPitch;
        clone.play();
    } catch (e) { }
}

// Música normal con fade in
function playMusicNormal() {
    if (!musicNormal.paused) return;

    musicHardcore.pause();
    musicHardcore.currentTime = 0;

    musicNormal.volume = 0.01;
    musicNormal.play().catch(() => { });

    let v = 0.01;
    const fade = setInterval(() => {
        v += 0.02;
        musicNormal.volume = Math.min(v, 0.22);
        if (v >= 0.22) clearInterval(fade);
    }, 40);
}

// Música hardcore con fade in
function playMusicHardcore() {
    musicNormal.pause();

    musicHardcore.volume = 0.01;
    musicHardcore.play().catch(() => { });

    let v = 0.01;
    const fade = setInterval(() => {
        v += 0.025;
        musicHardcore.volume = Math.min(v, 0.26);
        if (v >= 0.26) clearInterval(fade);
    }, 40);
}

function stopAllMusic() {
    musicNormal.pause();
    musicHardcore.pause();
}

function toggleHardcore() {
    // Solo tiene sentido cambiar Hardcore si estamos jugando
    if (gameState !== "playing") return;

    hardcoreActive = !hardcoreActive;
    screenShake = 8;

    comboTexts.push({
        x: canvas.width / 2,
        y: canvas.height / 2 - 80,
        text: hardcoreActive ? "HARDCORE ON" : "HARDCORE OFF",
        life: 800,
        color: hardcoreActive ? "#f97316" : "#38bdf8"
    });

    if (hardcoreActive) {
        playMusicHardcore();
    } else {
        playMusicNormal();
    }
}


// === Tema visual por nivel ===
function getLevelTheme() {
    const idx = (level - 1) % 4;
    switch (idx) {
        case 0:
            return "#090921"; // default
        case 1:
            return "#071827"; // azul frío
        case 2:
            return "#150b2f"; // violeta profundo
        case 3:
            return "#0b1724"; // intermedio
        default:
            return "#090921";
    }
}

// Cargar mejor puntaje
(function loadBestScore() {
    try {
        const stored = localStorage.getItem(BEST_SCORE_KEY);
        if (stored) bestScore = parseFloat(stored) || 0;
    } catch {
        bestScore = 0;
    }
})();

// --- INPUT TECLADO ---
window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        keys[e.code] = true;
    }

    if (e.code === "Space") {
        if (gameState === "ready" || gameState === "gameover") {
            restartGame();
            return;
        }
    }

    // Hardcore solo mientras se está jugando
    if (e.code === "KeyH" && gameState === "playing") {
        toggleHardcore();
    }
});

window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        keys[e.code] = false;
    }
});

// --- LÓGICA ---
function restartGame() {
    obstacles = [];
    powerups = [];
    isGameOver = false;
    score = 0;
    lastObstacleTime = 0;
    obstacleInterval = BASE_OBSTACLE_INTERVAL;
    player.x = canvas.width / 2 - player.width / 2;

    screenShake = 0;
    streaks.length = 0;
    particles.length = 0;
    playerTrail.length = 0;
    comboTexts.length = 0;

    combo = 0;
    lastNearMissTime = 0;
    slowMotionActive = false;
    slowMotionTimer = 0;
    shieldActive = false;
    shieldTimer = 0;
    hardcoreActive = false;

    level = 1;
    nextLevelScore = LEVEL_UP_SCORE;
    levelUpFlashTimer = 0;

    gameState = "playing";

    try {
        sfxShieldHum.pause();
        sfxShieldHum.currentTime = 0;
    } catch { }

    stopAllMusic();
    playMusicNormal();
}

function spawnObstacle() {
    let width = 40 + Math.random() * 40;
    let height = 20 + Math.random() * 20;
    const x = Math.random() * (canvas.width - width);
    let speed = 2 + Math.random() * 3;

    let type = "normal";
    const r = Math.random();
    if (r > 0.9) {
        type = "gold";
        width *= 0.8;
        height *= 0.8;
        speed += 1.5;
    } else if (r < 0.15) {
        type = "danger";
        width *= 1.3;
        height *= 1.1;
        speed -= 0.5;
    }

    speed += (level - 1) * 0.2;

    obstacles.push({
        x,
        y: -50,
        width,
        height,
        speed,
        type
    });
}

function spawnBlockParticles(obstacle, colorOverride) {
    const cx = obstacle.x + obstacle.width / 2;
    const cy = obstacle.y + obstacle.height / 2;
    const color = colorOverride || "#FFE600";

    const count = 12;
    for (let i = 0; i < count; i++) {
        particles.push({
            x: cx,
            y: cy,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 1.2) * 3,
            life: 300 + Math.random() * 200,
            radius: 2 + Math.random() * 2,
            color
        });
    }
}

function spawnPowerup() {
    const type = Math.random() < 0.5 ? "slow" : "shield";
    const size = 26;
    const x = Math.random() * (canvas.width - size);
    const speed = 2 + Math.random() * 2;

    powerups.push({
        x,
        y: -size,
        width: size,
        height: size,
        speed,
        type
    });
}

// Límites máximos de efectos según calidad
function getMaxParticles() {
    if (qualityProfile === QUALITY_HIGH) return 260;
    if (qualityProfile === QUALITY_MEDIUM) return 180;
    return 120; // LOW
}
function getMaxStreaks() {
    if (qualityProfile === QUALITY_HIGH) return 40;
    if (qualityProfile === QUALITY_MEDIUM) return 28;
    return 18;
}
function getMaxTrail() {
    if (qualityProfile === QUALITY_HIGH) return 40;
    if (qualityProfile === QUALITY_MEDIUM) return 26;
    return 18;
}
function getMaxComboTexts() {
    if (qualityProfile === QUALITY_HIGH) return 20;
    if (qualityProfile === QUALITY_MEDIUM) return 14;
    return 10;
}

function capArray(arr, max) {
    if (arr.length > max) {
        const extra = arr.length - max;
        arr.splice(0, extra);
    }
}

function update(deltaTime) {
    // Timer del flash rojo (en ms reales)
    if (hitFlashTimer > 0) {
        hitFlashTimer -= deltaTime;
        if (hitFlashTimer < 0) hitFlashTimer = 0;
    }

    // Hit-stop: congelamos lógica, pero permitimos dibujar
    if (hitStopTimer > 0) {
        hitStopTimer -= deltaTime;
        if (hitStopTimer <= 0 && gameState === "playing" && isGameOver) {
            gameState = "gameover";
        }
        return;
    }

    if (gameState !== "playing") return;

    const dt = deltaTime / 16.67;

    const levelSpeed = 1 + (level - 1) * 0.08;
    const speedFactor =
        (slowMotionActive ? 0.4 : 1) *
        (hardcoreActive ? 1.5 : 1) *
        levelSpeed;

    const scoreMultiplier = hardcoreActive ? 2 : 1;

    // Jugador
    if (keys.ArrowLeft) {
        player.x -= player.speed * dt;
    }
    if (keys.ArrowRight) {
        player.x += player.speed * dt;
    }

    if (player.x < 0) player.x = 0;
    if (player.x + player.width > canvas.width)
        player.x = canvas.width - player.width;

    // Trail del jugador
    playerTrail.push({
        x: player.x,
        y: player.y,
        width: player.width,
        height: player.height,
        life: 200
    });
    playerTrail.forEach(t => t.life -= deltaTime);
    for (let i = playerTrail.length - 1; i >= 0; i--) {
        if (playerTrail[i].life <= 0) playerTrail.splice(i, 1);
    }

    // Obstáculos
    lastObstacleTime += deltaTime;
    const intervalFactor = hardcoreActive ? 0.8 : 1;
    if (lastObstacleTime > obstacleInterval * intervalFactor) {
        spawnObstacle();
        lastObstacleTime = 0;
        if (obstacleInterval > MIN_OBSTACLE_INTERVAL) obstacleInterval -= 10;
    }

    // Powerups
    powerupTimer += deltaTime;
    if (powerupTimer > POWERUP_INTERVAL) {
        spawnPowerup();
        powerupTimer = 0;
    }

    // Actualizar obstáculos
    obstacles.forEach(o => {
        o.y += o.speed * speedFactor * dt;

        const playerBottom = player.y + player.height;
        const obstacleBottom = o.y + o.height;

        const horizontalOverlap =
            o.x < player.x + player.width &&
            o.x + o.width > player.x;

        const isNearVertically =
            obstacleBottom >= player.y - NEAR_MISS_DISTANCE &&
            obstacleBottom <= playerBottom + NEAR_MISS_DISTANCE;

        if (!isGameOver && horizontalOverlap && isNearVertically && !o._nearMissTriggered) {
            o._nearMissTriggered = true;

            screenShake = Math.max(screenShake, 6);

            streaks.push({
                x: player.x + player.width / 2,
                y: player.y + player.height / 2,
                vx: (Math.random() - 0.5) * 5,
                vy: -8,
                life: 200
            });

            combo++;
            lastNearMissTime = 0;
            if (combo > bestCombo) bestCombo = combo;

            comboTexts.push({
                x: player.x + player.width / 2,
                y: player.y - 10,
                text: "x" + combo,
                life: 800,
                color: "#e5e7eb"
            });

            try {
                playSfx(sfxNearMiss, { pitchMin: 0.98, pitchMax: 1.06 });
            } catch { }
        }

        if (o.y > canvas.height && !o._remove) {
            o._remove = true;

            let pColor = "#FFE600";
            if (o.type === "danger") pColor = "#f97316";
            if (o.type === "gold") pColor = "#facc15";

            spawnBlockParticles(o, pColor);

            if (o.type === "gold") {
                score += 50;
                comboTexts.push({
                    x: o.x + o.width / 2,
                    y: canvas.height - 80,
                    text: "+50",
                    life: 700,
                    color: "#facc15"
                });
            }

            try {
                playSfx(sfxBlockPass, { pitchMin: 0.94, pitchMax: 1.03 });
            } catch { }
        }
    });

    obstacles = obstacles.filter(o => !o._remove && o.y < canvas.height + 80);

    // Actualizar powerups
    powerups.forEach(p => {
        p.y += p.speed * (slowMotionActive ? 0.5 : 0.9) * dt;
    });

    powerups.forEach(p => {
        if (!p._taken && isColliding(player, p)) {
            p._taken = true;
            if (p.type === "slow") {
                slowMotionActive = true;
                slowMotionTimer = 3500;
                comboTexts.push({
                    x: player.x + player.width / 2,
                    y: player.y - 30,
                    text: "SLOW MOTION",
                    life: 900,
                    color: "#38bdf8"
                });
            } else if (p.type === "shield") {
                shieldActive = true;
                shieldTimer = 16000;
                comboTexts.push({
                    x: player.x + player.width / 2,
                    y: player.y - 30,
                    text: "ESCUDO ACTIVADO",
                    life: 900,
                    color: "#34d399"
                });
                try {
                    sfxShieldHum.currentTime = 0;
                    sfxShieldHum.play();
                } catch { }
            }
            try {
                playSfx(sfxPowerup, { pitchMin: 1.0, pitchMax: 1.08 });
            } catch { }
        }
    });
    powerups = powerups.filter(p => !p._taken && p.y < canvas.height + 40);

    // Colisiones jugador-bloque
    for (const o of obstacles) {
        if (isColliding(player, o)) {
            if (shieldActive) {
                shieldActive = false;
                shieldTimer = 0;
                o._remove = true;
                spawnBlockParticles(o, "#34d399");
                screenShake = 10;
                try {
                    sfxShieldHit.currentTime = 0;
                    sfxShieldHit.play();
                    sfxShieldHum.pause();
                    sfxShieldHum.currentTime = 0;
                } catch { }
            } else {
                isGameOver = true;
                combo = 0;

                // Hit-stop y flash
                hitStopTimer = 140;  // ms
                hitFlashTimer = 160; // ms
                screenShake = 12;

                stopAllMusic();

                try {
                    playSfx(sfxGameOver, { pitchMin: 0.98, pitchMax: 1.0 });
                    sfxShieldHum.pause();
                    sfxShieldHum.currentTime = 0;
                } catch { }

                if (score > bestScore) {
                    bestScore = score;
                    try {
                        localStorage.setItem(BEST_SCORE_KEY, bestScore.toString());
                    } catch { }
                }
                break;
            }
        }
    }

    // Score y niveles
    score += deltaTime * 0.01 * scoreMultiplier;

    if (!isGameOver && score >= nextLevelScore) {
        level++;
        nextLevelScore = level * LEVEL_UP_SCORE;
        levelUpFlashTimer = 1800;
        screenShake = Math.max(screenShake, 10);

        comboTexts.push({
            x: canvas.width / 2,
            y: 120,
            text: "Nivel " + level,
            life: 1000,
            color: "#a5b4fc"
        });

        try {
            playSfx(sfxLevelUp, { pitchMin: 1.0, pitchMax: 1.05 });
        } catch { }
    }

    if (levelUpFlashTimer > 0) {
        levelUpFlashTimer -= deltaTime;
        if (levelUpFlashTimer < 0) levelUpFlashTimer = 0;
    }

    // Streaks
    streaks.forEach(s => {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= deltaTime;
    });
    for (let i = streaks.length - 1; i >= 0; i--) {
        if (streaks[i].life <= 0) streaks.splice(i, 1);
    }

    // Partículas
    particles.forEach(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= deltaTime;
    });
    for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // Textos flotantes
    comboTexts.forEach(t => {
        t.y -= 0.7 * dt;
        t.life -= deltaTime;
    });
    for (let i = comboTexts.length - 1; i >= 0; i--) {
        if (comboTexts[i].life <= 0) comboTexts.splice(i, 1);
    }

    // Timers
    if (slowMotionActive) {
        slowMotionTimer -= deltaTime;
        if (slowMotionTimer <= 0) slowMotionActive = false;
    }

    if (shieldActive) {
        shieldTimer -= deltaTime;
        if (shieldTimer <= 0) {
            shieldActive = false;
            try {
                sfxShieldHum.pause();
                sfxShieldHum.currentTime = 0;
            } catch { }
        }
    }

    lastNearMissTime += deltaTime;
    if (lastNearMissTime > 3000 && combo > 0) {
        combo = 0;
        lastNearMissTime = 0;
    }

    // --- CAP de efectos para evitar explosiones en móviles ---
    capArray(particles, getMaxParticles());
    capArray(streaks, getMaxStreaks());
    capArray(playerTrail, getMaxTrail());
    capArray(comboTexts, getMaxComboTexts());
}

function isColliding(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function drawTextWithStroke(text, x, y, size = 20, color = "#fff") {
    ctx.font = size + "px system-ui";
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const width = canvas.width;
    const height = canvas.height;

    ctx.save();

    // Screen shake
    if (screenShake > 0) {
        const dx = (Math.random() - 0.5) * screenShake;
        const dy = (Math.random() - 0.5) * screenShake;
        ctx.translate(dx, dy);
        screenShake *= 0.9;
        if (screenShake < 0.3) screenShake = 0;
    }

    // Micro tilt de cámara
    if (gameState === "playing") {
        const playerCenterX = player.x + player.width / 2;
        const offsetNorm = (playerCenterX - width / 2) / (width / 2);
        const baseTiltFactor = 0.01;
        const hardcoreExtra = hardcoreActive ? 0.10 : 0.0;
        const tilt = baseTiltFactor + hardcoreExtra;

        const tiltX = offsetNorm * 8 * tilt;
        const tiltY = Math.abs(offsetNorm) * 4 * tilt;
        ctx.translate(tiltX, tiltY);
    }

    // Fondo principal
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    const midColor = getLevelTheme();
    bgGradient.addColorStop(0, "#05010a");
    bgGradient.addColorStop(0.35, midColor);
    bgGradient.addColorStop(1, "#05010a");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Scanlines (solo calidad alta)
    if (qualityProfile === QUALITY_HIGH) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = "#111827";
        for (let y = 0; y < height; y += 8) {
            ctx.fillRect(0, y, width, 1);
        }
        ctx.restore();
    }

    // Estrellas en 3 capas
    starLayers.forEach(layer => {
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${layer.alpha})`;
        layer.stars.forEach(star => {
            star.y += layer.speed;
            star.x += layer.speed * 0.3;

            if (star.y > height) {
                star.y = 0;
                star.x = Math.random() * width;
            }
            if (star.x > width) {
                star.x = 0;
            }

            ctx.beginPath();
            ctx.arc(star.x, star.y, layer.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    });

    // Motion field diagonal suave (lo desactivamos en LOW)
    if (qualityProfile !== QUALITY_LOW) {
        motionFieldOffset += 0.6;
        let spacing = 46;
        if (qualityProfile === QUALITY_MEDIUM) spacing = 60;

        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = "rgba(148,163,184,0.75)";
        ctx.lineWidth = 1;

        for (let i = -height; i < width + height; i += spacing) {
            const x1 = i + motionFieldOffset;
            const y1 = 0;
            const x2 = x1 - height;
            const y2 = height;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        ctx.restore();
    }


    // Vignette
    const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.2,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.75
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Fog / neblina
    ctx.save();
    const fogStartY = height * 0.55;
    const fogBase = 0.04;
    const fogExtra = Math.min(0.06, 0.02 * (level - 1));
    const fogAlpha = fogBase + fogExtra;

    const fogGradient = ctx.createLinearGradient(0, fogStartY, 0, height);
    fogGradient.addColorStop(0, "rgba(0,0,0,0.0)");
    fogGradient.addColorStop(1, `rgba(0,0,0,${fogAlpha})`);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = fogGradient;
    ctx.fillRect(0, fogStartY, width, height - fogStartY);
    ctx.restore();

    // Tint según powerups
    if (shieldActive) {
        ctx.save();
        ctx.fillStyle = "rgba(34,197,94,0.06)";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    if (slowMotionActive) {
        ctx.save();
        ctx.fillStyle = "rgba(56,189,248,0.05)";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    if (levelUpFlashTimer > 0) {
        const alphaFlash = Math.max(0, levelUpFlashTimer / 1800) * 0.6;
        ctx.save();
        ctx.fillStyle = `rgba(129,140,248,${alphaFlash})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    // Trail del jugador
    playerTrail.forEach(t => {
        const alpha = Math.max(0, t.life / 200);
        ctx.save();
        ctx.globalAlpha = alpha * 0.45;
        const trailGradient = ctx.createLinearGradient(
            t.x,
            t.y,
            t.x,
            t.y + t.height
        );
        trailGradient.addColorStop(0, "rgba(56,189,248,0.1)");
        trailGradient.addColorStop(1, "rgba(56,189,248,0.6)");
        ctx.fillStyle = trailGradient;
        drawRoundedRect(ctx, t.x, t.y, t.width, t.height, 6);
        ctx.fill();
        ctx.restore();
    });

    // Jugador
    ctx.save();

    const tTime = (lastTime || 0);
    const pulse = 1 + 0.05 * Math.sin(tTime / 260);
    const wobble = hardcoreActive ? 1.5 * Math.sin(tTime / 90) : 0;

    const drawWidth = player.width * pulse;
    const drawHeight = player.height * pulse;
    const drawX = player.x + (player.width - drawWidth) / 2 + wobble;
    const drawY = player.y + (player.height - drawHeight) / 2;

    const baseColorTop = shieldActive ? "#6ee7b7" : "#a5f3fc";
    const baseColorBottom = shieldActive ? "#10b981" : "#06b6d4";

    const playerGradient = ctx.createLinearGradient(
        drawX,
        drawY,
        drawX,
        drawY + drawHeight
    );
    playerGradient.addColorStop(0, baseColorTop);
    playerGradient.addColorStop(0.5, shieldActive ? "#34d399" : "#22d3ee");
    playerGradient.addColorStop(1, baseColorBottom);

    ctx.shadowColor = shieldActive ? "#34d399" : "#22d3ee";
    ctx.shadowBlur = shieldActive ? 24 : 18;

    ctx.fillStyle = playerGradient;
    drawRoundedRect(ctx, drawX, drawY, drawWidth, drawHeight, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(15,23,42,0.95)";
    drawRoundedRect(
        ctx,
        drawX + 0.5,
        drawY + 0.5,
        drawWidth - 1,
        drawHeight - 1,
        7.5
    );
    ctx.stroke();

    // Franja central
    const midHeight = drawHeight * 0.45;
    const midY = drawY + drawHeight / 2 - midHeight / 2;
    const stripeGradient = ctx.createLinearGradient(
        drawX,
        midY,
        drawX,
        midY + midHeight
    );
    stripeGradient.addColorStop(0, "rgba(15,23,42,0.0)");
    stripeGradient.addColorStop(0.5, "rgba(255,255,255,0.7)");
    stripeGradient.addColorStop(1, "rgba(15,23,42,0.0)");

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = stripeGradient;
    drawRoundedRect(
        ctx,
        drawX + 3,
        midY,
        drawWidth - 6,
        midHeight,
        6
    );
    ctx.fill();

    ctx.restore();

    const neonColors = {
        normal: "#22d3ee",
        gold: "#fde047",
        danger: "#fb7185"
    };

    // Obstáculos con gradiente y bloom dorado (bloom sólo en high/medium)
    obstacles.forEach(o => {
        const base = neonColors[o.type] || "#22d3ee";
        const isGold = o.type === "gold";
        const isDanger = o.type === "danger";

        ctx.save();

        // Bloom extra para dorados (evitado en LOW)
        if (isGold && qualityProfile !== QUALITY_LOW) {
            ctx.save();

            const cx = o.x + o.width / 2;
            const cy = o.y + o.height / 2;
            const radius = Math.max(o.width, o.height) * 1.0;

            ctx.globalCompositeOperation = "lighter";
            const bloomGradient = ctx.createRadialGradient(
                cx,
                cy,
                0,
                cx,
                cy,
                radius
            );
            bloomGradient.addColorStop(0, "rgba(254,249,195,0.85)");
            bloomGradient.addColorStop(0.5, "rgba(250,204,21,0.45)");
            bloomGradient.addColorStop(1, "rgba(250,204,21,0.0)");

            ctx.fillStyle = bloomGradient;
            const pad = 14;
            ctx.fillRect(
                o.x - pad,
                o.y - pad,
                o.width + pad * 2,
                o.height + pad * 2
            );

            ctx.restore();
        }

        const blockGradient = ctx.createLinearGradient(
            o.x,
            o.y,
            o.x,
            o.y + o.height
        );

        if (isGold) {
            blockGradient.addColorStop(0, "#fef9c3");
            blockGradient.addColorStop(0.4, base);
            blockGradient.addColorStop(1, "#b45309");
        } else if (isDanger) {
            blockGradient.addColorStop(0, "#fecaca");
            blockGradient.addColorStop(0.4, base);
            blockGradient.addColorStop(1, "#7f1d1d");
        } else {
            blockGradient.addColorStop(0, "#cffafe");
            blockGradient.addColorStop(0.4, base);
            blockGradient.addColorStop(1, "#0f172a");
        }

        // Sombras más suaves en LOW
        if (qualityProfile === QUALITY_HIGH) {
            ctx.shadowBlur = isDanger ? 22 : (isGold ? 20 : 16);
        } else if (qualityProfile === QUALITY_MEDIUM) {
            ctx.shadowBlur = isDanger ? 16 : (isGold ? 14 : 10);
        } else {
            ctx.shadowBlur = 6;
        }
        ctx.shadowColor = base;

        ctx.fillStyle = blockGradient;
        drawRoundedRect(ctx, o.x, o.y, o.width, o.height, 8);
        ctx.fill();

        ctx.shadowBlur = 0;

        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "rgba(15,23,42,0.85)";
        drawRoundedRect(
            ctx,
            o.x + 1,
            o.y + o.height * 0.55,
            o.width - 2,
            o.height * 0.45,
            7
        );
        ctx.fill();
        ctx.restore();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(15,23,42,0.9)";
        drawRoundedRect(ctx, o.x + 0.5, o.y + 0.5, o.width - 1, o.height - 1, 7.5);
        ctx.stroke();

        ctx.restore();
    });

    // Power-ups
    powerups.forEach(p => {
        const isSlow = p.type === "slow";
        const baseColor = isSlow ? "#38bdf8" : "#34d399";
        const label = isSlow ? "⏱" : "🛡";
        const cx = p.x + p.width / 2;
        const cy = p.y + p.height / 2;
        const radius = p.width / 2;

        const tPulse = (lastTime || 0) * 0.005;
        const pulse = 0.08 * Math.sin(tPulse) + 0.15;

        ctx.save();

        ctx.globalAlpha = 0.45;
        const haloGradient = ctx.createRadialGradient(
            cx,
            cy,
            radius * 0.8,
            cx,
            cy,
            radius * 1.5
        );
        haloGradient.addColorStop(0, "rgba(15,23,42,0.0)");
        haloGradient.addColorStop(1, isSlow
            ? "rgba(56,189,248,0.7)"
            : "rgba(52,211,153,0.7)");
        ctx.fillStyle = haloGradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;

        const coreGradient = ctx.createRadialGradient(
            cx,
            cy,
            radius * 0.3,
            cx,
            cy,
            radius
        );
        coreGradient.addColorStop(0, "#ecfeff");
        coreGradient.addColorStop(0.45, baseColor);
        coreGradient.addColorStop(1, isSlow ? "#0ea5e9" : "#059669");

        ctx.shadowColor = baseColor;
        ctx.shadowBlur =
            qualityProfile === QUALITY_LOW ? 10 :
                (qualityProfile === QUALITY_MEDIUM ? 14 : 18);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = coreGradient;
        ctx.fill();

        ctx.shadowBlur = 0;

        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(15,23,42,0.95)";
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#0b1120";
        ctx.font = "20px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy + 1);

        ctx.globalAlpha = pulse;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.beginPath();
        ctx.arc(cx, cy - radius * 0.3, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    });

    // Partículas
    particles.forEach(p => {
        const alpha = Math.max(0, p.life / 500);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // Streaks
    streaks.forEach(s => {
        const alpha = Math.max(0, s.life / 200);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x, s.y + 18);
        ctx.stroke();
        ctx.restore();
    });

    // Textos flotantes
    comboTexts.forEach(t => {
        const alpha = Math.max(0, t.life / 800);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = t.color || "#e5e7eb";
        ctx.font = "18px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
    });

    // HUD superior
    const blinkSlow = slowMotionActive && slowMotionTimer <= 1200;
    const blinkShield = shieldActive && shieldTimer <= 1500;

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "rgba(15,23,42,0.96)";
    ctx.fillRect(0, 0, width, 58);
    ctx.restore();

    // Puntaje actual
    ctx.save();
    ctx.textAlign = "left";
    drawTextWithStroke("Puntaje " + Math.floor(score), 20, 32, 22);
    drawTextWithStroke("Mejor " + Math.floor(bestScore), 20, 52, 14);
    ctx.restore();

    // Nivel + combo (derecha)
    ctx.save();
    ctx.textAlign = "right";

    const isLevelHighlight = (gameState === "playing" && levelUpFlashTimer > 0);
    const levelSize = isLevelHighlight ? 24 : 18;
    const levelColor = isLevelHighlight ? "#fde047" : "#ffffff";

    drawTextWithStroke("Nivel " + level, width - 20, 32, levelSize, levelColor);
    if (isLevelHighlight) {
        drawTextWithStroke("↑", width - 20, 16, 14, "#facc15");
    }

    drawTextWithStroke("Combo x" + combo, width - 20, 52, 14);
    ctx.restore();

    // Estado habilidades centro
    ctx.save();
    ctx.textAlign = "center";

    let statusY = 18;
    let statusX = width / 2;

    if (hardcoreActive) {
        ctx.fillStyle = "#f97316";
        ctx.font = "14px system-ui";
        ctx.fillText("HARDCORE", statusX, statusY);
        statusY += 16;
    }

    if (slowMotionActive) {
        let alpha = 1;
        if (blinkSlow) alpha = 0.4 + 0.6 * Math.abs(Math.sin((lastTime || 0) / 160));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#38bdf8";
        ctx.font = "13px system-ui";
        ctx.fillText("SLOW", statusX, statusY);
        statusY += 16;
        ctx.globalAlpha = 1;
    }

    if (shieldActive) {
        let alpha = 1;
        if (blinkShield) alpha = 0.4 + 0.6 * Math.abs(Math.sin((lastTime || 0) / 160));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#34d399";
        ctx.font = "13px system-ui";
        ctx.fillText("ESCUDO", statusX, statusY);
        ctx.globalAlpha = 1;
    }

    ctx.restore();

    const centerX = width / 2;
    const centerY = height * 0.46;

    // Flash de impacto rojo
    if (hitFlashTimer > 0) {
        const alpha = Math.max(0, hitFlashTimer / 160) * 0.55;
        ctx.save();
        ctx.fillStyle = `rgba(248,113,113,${alpha})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    // Banner de subida de nivel
    if (gameState === "playing" && levelUpFlashTimer > 0) {
        const t = Math.max(0, levelUpFlashTimer / 1800);
        const alpha = 0.9 * t;
        const scale = 1 + 0.06 * (1 - t);

        const baseWidth = 260;
        const baseHeight = 70;
        const bannerWidth = baseWidth * scale;
        const bannerHeight = baseHeight * scale;

        const bx = centerX - bannerWidth / 2;
        const by = centerY - bannerHeight / 2 - 90;

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.fillStyle = "rgba(15,23,42,0.96)";
        drawRoundedRect(ctx, bx, by, bannerWidth, bannerHeight, 16);
        ctx.fill();

        const borderGradient = ctx.createLinearGradient(
            bx,
            by,
            bx + bannerWidth,
            by + bannerHeight
        );
        borderGradient.addColorStop(0, "#4f46e5");
        borderGradient.addColorStop(1, "#a855f7");
        ctx.lineWidth = 2;
        ctx.strokeStyle = borderGradient;
        drawRoundedRect(ctx, bx, by, bannerWidth, bannerHeight, 16);
        ctx.stroke();

        ctx.shadowColor = "#a5b4fc";
        ctx.shadowBlur = 18;

        ctx.fillStyle = "#e5e7eb";
        ctx.textAlign = "center";
        ctx.font = "20px system-ui";
        ctx.fillText("¡Nivel " + level + "!", centerX, by + bannerHeight / 2 - 6);

        ctx.shadowBlur = 0;
        ctx.font = "13px system-ui";
        ctx.fillStyle = "#9ca3af";
        ctx.fillText("Velocidad aumentada", centerX, by + bannerHeight / 2 + 14);

        ctx.restore();
    }

    // Pantalla READY
    if (gameState === "ready") {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, width, height);

        ctx.textAlign = "center";

        drawTextWithStroke("🎮 ESQUIVA LOS BLOQUES", centerX, centerY - 40, 26);
        drawTextWithStroke("Mueve con ◀ ▶  |  Espacio para empezar", centerX, centerY - 5, 16);
        drawTextWithStroke("H para Modo Hardcore", centerX, centerY + 22, 14);

        ctx.restore();
    }

    // Pantalla GAME OVER
    if (gameState === "gameover") {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, 0, width, height);

        ctx.textAlign = "center";

        drawTextWithStroke("💀 GAME OVER 💀", centerX, centerY - 32, 34);
        drawTextWithStroke("Puntaje final: " + Math.floor(score), centerX, centerY + 4, 20);
        drawTextWithStroke("Mejor: " + Math.floor(bestScore), centerX, centerY + 32, 16);
        drawTextWithStroke("Pulsa ESPACIO para reiniciar", centerX, centerY + 64, 16);

        ctx.restore();
    }

    ctx.restore();
}

// Loop
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    // --- MEDIR FPS Y ADAPTAR CALIDAD ---
    const fps = 1000 / (deltaTime || 1);
    fpsSamples.push(fps);
    if (fpsSamples.length >= FPS_WINDOW) {
        const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
        fpsSamples = [];

        if (avgFps < FPS_THRESHOLD) {
            lowFpsStrikes++;
            if (lowFpsStrikes >= FPS_STRIKES_TO_LOWER) {
                downgradeQualityProfile();
                lowFpsStrikes = 0;
                // Re-inicializar estrellas con nueva calidad
                initStars();
            }
        } else {
            // si va bien, no subimos la calidad, solo reiniciamos strikes
            lowFpsStrikes = 0;
        }
    }

    update(deltaTime);
    draw();

    requestAnimationFrame(gameLoop);
}

// Inicializar estrellas
initStars();

// Empezar loop
requestAnimationFrame(gameLoop);
