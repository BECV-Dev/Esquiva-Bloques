const GAME_VERSION = "v0.2";
console.log("Esquiva los bloques –", GAME_VERSION);

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Mostrar versión en la UI
const versionTag = document.getElementById("versionTag");
if (versionTag) {
    versionTag.textContent = GAME_VERSION;
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

let lastTapTime = 0;

let powerupTimer = 0;
const POWERUP_INTERVAL = 8000;

let isGameOver = false;
let score = 0;
let bestScore = 0;
let lastTime = 0;
let gameState = "ready";

const BEST_SCORE_KEY = "dodge_best_score_v1";

const keys = {
    ArrowLeft: false,
    ArrowRight: false
};

// --- DETECCIÓN TOUCH + CONTROLES MÓVILES ---
const isTouchDevice =
    ("ontouchstart" in window) ||
    (navigator.maxTouchPoints > 0) ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

if (isTouchDevice) {
    document.body.classList.add("is-touch");

    const btnLeft = document.getElementById("btnLeft");
    const btnRight = document.getElementById("btnRight");

    const pressLeft = (e) => {
        e.preventDefault();
        keys.ArrowLeft = true;
    };
    const releaseLeft = (e) => {
        e.preventDefault();
        keys.ArrowLeft = false;
    };

    const pressRight = (e) => {
        e.preventDefault();
        keys.ArrowRight = true;
    };
    const releaseRight = (e) => {
        e.preventDefault();
        keys.ArrowRight = false;
    };

    // Botones táctiles
    btnLeft.addEventListener("touchstart", pressLeft);
    btnLeft.addEventListener("touchend", releaseLeft);
    btnLeft.addEventListener("touchcancel", releaseLeft);

    btnRight.addEventListener("touchstart", pressRight);
    btnRight.addEventListener("touchend", releaseRight);
    btnRight.addEventListener("touchcancel", releaseRight);

    // Click por si hay mouse en tablet
    btnLeft.addEventListener("mousedown", pressLeft);
    btnLeft.addEventListener("mouseup", releaseLeft);
    btnLeft.addEventListener("mouseleave", releaseLeft);

    btnRight.addEventListener("mousedown", pressRight);
    btnRight.addEventListener("mouseup", releaseRight);
    btnRight.addEventListener("mouseleave", releaseRight);

    // Touch directo sobre canvas
    const handleCanvasTouch = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;

        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;

        const middle = rect.width / 2;
        const deadZone = rect.width * 0.1;

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

    // Siempre soltar los "botones" virtuales
    keys.ArrowLeft = false;
    keys.ArrowRight = false;

    const now = performance.now();

    // 👉 En móvil: tocar el canvas en READY o GAMEOVER = empezar / reiniciar
    if (gameState === "ready" || gameState === "gameover") {
        restartGame();
    } else if (gameState === "playing") {
        // 👉 En móvil: doble toque rápido durante la partida = toggle Hardcore
        if (now - lastTapTime < 280) { // ventana de ~280ms entre taps
            toggleHardcore();
        }
    }

    lastTapTime = now;
};

    canvas.addEventListener("touchstart", handleCanvasTouch);
    canvas.addEventListener("touchmove", handleCanvasTouch);
    canvas.addEventListener("touchend", handleCanvasTouchEnd);
    canvas.addEventListener("touchcancel", handleCanvasTouchEnd);
}

// --- CÁMARA / MICRO-TILT ---
let cameraTilt = 0;              // ángulo actual en radianes
const CAMERA_TILT_MAX = 0.0;   // ~2° máximo de inclinación
const CAMERA_TILT_SMOOTH = 0.0; // qué tan suave sigue el target

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
const STAR_LAYERS_CONFIG = [
    { count: 40, speed: 0.08, radius: 1.0, alpha: 0.20 },
    { count: 30, speed: 0.16, radius: 1.4, alpha: 0.28 },
    { count: 20, speed: 0.28, radius: 2.0, alpha: 0.38 }
];

let starLayers = [];

function initStars() {
    const width = canvas.width;
    const height = canvas.height;

    starLayers = STAR_LAYERS_CONFIG.map(layerConf => {
        const stars = [];
        for (let i = 0; i < layerConf.count; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height
            });
        }
        return {
            ...layerConf,
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

// Volúmenes objetivo (no estorban SFX)
const MUSIC_NORMAL_TARGET_VOL = 0.22;
const MUSIC_HARDCORE_TARGET_VOL = 0.26;

// Estado actual
let currentMusic = null;        // referencia al Audio en uso
let currentMusicMode = null;    // "normal" | "hardcore" | null
let musicFadeInterval = null;   // para no tener múltiples fades a la vez

function switchMusic(mode) {
    // Evitar reprocesar si ya estamos en ese modo
    if (currentMusicMode === mode) return;

    // Elegir pista y volumen objetivo según modo
    let targetAudio, targetVolume;
    if (mode === "hardcore") {
        targetAudio = musicHardcore;
        targetVolume = MUSIC_HARDCORE_TARGET_VOL;
    } else {
        // modo "normal" por defecto
        targetAudio = musicNormal;
        targetVolume = MUSIC_NORMAL_TARGET_VOL;
    }

    // Limpiamos cualquier fade anterior
    if (musicFadeInterval) {
        clearInterval(musicFadeInterval);
        musicFadeInterval = null;
    }

    const fadeDuration = 600; // ms
    const steps = 24;
    const stepTime = fadeDuration / steps;

    const fromMusic = currentMusic;
    const fromStartVol = fromMusic ? fromMusic.volume : 0;

    // Configurar pista destino
    targetAudio.volume = 0;
    if (targetAudio.paused) {
        // Por políticas de navegador, esto funciona una vez que ya hubo interacción del usuario
        targetAudio.play().catch(() => { /* ignorar errores de autoplay */ });
    }

    let step = 0;
    currentMusicMode = mode; // ya consideramos este modo como objetivo

    musicFadeInterval = setInterval(() => {
        step++;
        const t = step / steps; // 0 → 1

        // Fade out de la música anterior
        if (fromMusic) {
            const newVol = fromStartVol * (1 - t);
            fromMusic.volume = Math.max(newVol, 0);
        }

        // Fade in de la nueva música
        const newTargetVol = targetVolume * t;
        targetAudio.volume = Math.min(newTargetVol, targetVolume);

        if (step >= steps) {
            clearInterval(musicFadeInterval);
            musicFadeInterval = null;

            // Apagar completamente la anterior al final del crossfade
            if (fromMusic && fromMusic !== targetAudio) {
                fromMusic.pause();
                fromMusic.currentTime = 0;
            }

            // Fijar estado
            currentMusic = targetAudio;
            currentMusicMode = mode;
        }
    }, stepTime);
}

function stopAllMusic(fade = true) {
    if (!currentMusic) {
        musicNormal.pause();
        musicHardcore.pause();
        return;
    }

    if (!fade) {
        currentMusic.pause();
        currentMusic.currentTime = 0;
        musicNormal.pause();
        musicHardcore.pause();
        currentMusic = null;
        currentMusicMode = null;
        return;
    }

    // Fade-out suave del tema actual
    if (musicFadeInterval) {
        clearInterval(musicFadeInterval);
        musicFadeInterval = null;
    }

    const fadeDuration = 500;
    const steps = 20;
    const stepTime = fadeDuration / steps;

    const startVol = currentMusic.volume;
    let step = 0;

    musicFadeInterval = setInterval(() => {
        step++;
        const t = step / steps;
        const newVol = startVol * (1 - t);
        currentMusic.volume = Math.max(newVol, 0);

        if (step >= steps) {
            clearInterval(musicFadeInterval);
            musicFadeInterval = null;
            currentMusic.pause();
            currentMusic.currentTime = 0;
            currentMusic = null;
            currentMusicMode = null;
        }
    }, stepTime);
}



// --- Helper de audio SIMPLE (sin panning, solo pitch) ---
function playSfx(audio, {
    volume = null,
    pitchMin = 0.96,
    pitchMax = 1.04
} = {}) {
    try {
        audio.pause();
        audio.currentTime = 0;
        const randPitch = pitchMin + Math.random() * (pitchMax - pitchMin);
        audio.playbackRate = randPitch;
        if (volume !== null) audio.volume = volume;
        audio.play();
    } catch (e) { }
}

// === Tema visual por nivel ===
function getLevelTheme() {
    const idx = (level - 1) % 4;
    switch (idx) {
        case 0:
            return "#090921"; // azul violeta (default)
        case 1:
            return "#071827"; // azul más frío
        case 2:
            return "#150b2f"; // violeta más profundo
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
        // Inicio de partida desde pantalla "ready"
        if (gameState === "ready") {
            restartGame();
            return;
        }

        // Reinicio después de GAME OVER
        if (gameState === "gameover") {
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

function toggleHardcore() {
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
}

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

    // Al reiniciar o empezar desde "ready", entramos a modo juego
    gameState = "playing";
    switchMusic("normal");

    try {
        sfxShieldHum.pause();
        sfxShieldHum.currentTime = 0;
    } catch { }
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

    for (let i = 0; i < 12; i++) {
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

function update(deltaTime) {
    // Hit-stop: congelamos todo menos el dibujo
    if (hitStopTimer > 0) {
        hitStopTimer -= deltaTime;
        if (hitStopTimer <= 0 && gameState === "playing" && isGameOver) {
            gameState = "gameover";
        }
        return; // NO actualizamos posiciones durante el hit-stop
    }

    // Solo actualizamos el mundo cuando estamos jugando
    if (gameState !== "playing") return;

    // dt ~1 cuando el juego corre a 60 FPS
    const dt = deltaTime / 16.67;

    const levelSpeed = 1 + (level - 1) * 0.08;
    const speedFactor =
        (slowMotionActive ? 0.4 : 1) *
        (hardcoreActive ? 1.5 : 1) *
        levelSpeed;

    const scoreMultiplier = hardcoreActive ? 2 : 1;

    // jugador
    if (keys.ArrowLeft) {
        player.x -= player.speed * dt;
    }
    if (keys.ArrowRight) {
        player.x += player.speed * dt;
    }

    if (player.x < 0) player.x = 0;
    if (player.x + player.width > canvas.width)
        player.x = canvas.width - player.width;

        // Micro-tilt de cámara según input horizontal
    let targetTilt = 0;
    if (keys.ArrowLeft) {
        targetTilt = -CAMERA_TILT_MAX;
    } else if (keys.ArrowRight) {
        targetTilt = CAMERA_TILT_MAX;
    }

    // En Hardcore inclinamos un poquito más
    if (hardcoreActive) {
        targetTilt *= 1.4;
    }

    // Interpolación suave hacia el ángulo objetivo
    cameraTilt += (targetTilt - cameraTilt) * CAMERA_TILT_SMOOTH;

    // trail
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

    // obstáculos
    lastObstacleTime += deltaTime;
    const intervalFactor = hardcoreActive ? 0.8 : 1;
    if (lastObstacleTime > obstacleInterval * intervalFactor) {
        spawnObstacle();
        lastObstacleTime = 0;
        if (obstacleInterval > MIN_OBSTACLE_INTERVAL) obstacleInterval -= 10;
    }

    // powerups
    powerupTimer += deltaTime;
    if (powerupTimer > POWERUP_INTERVAL) {
        spawnPowerup();
        powerupTimer = 0;
    }

    // actualizar obstáculos
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

    // actualizar powerups
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
                gameState = "gameover";
                stopAllMusic(true); // fade-out suave
                combo = 0;

                // Activamos hit-stop y flash
                hitStopTimer = 140;  // ms de congelamiento
                hitFlashTimer = 160; // ms de flash rojo
                screenShake = 12;

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

    // score y niveles
    score += deltaTime * 0.01 * scoreMultiplier;

    if (!isGameOver && score >= nextLevelScore) {
        level++;
        nextLevelScore = level * LEVEL_UP_SCORE;
        levelUpFlashTimer = 1800; // dura un poco más el aviso de nivel
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
    } catch {}
    }

    if (levelUpFlashTimer > 0) {
        levelUpFlashTimer -= deltaTime;
        if (levelUpFlashTimer < 0) levelUpFlashTimer = 0;
    }

    // streaks
    streaks.forEach(s => {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= deltaTime;
    });
    for (let i = streaks.length - 1; i >= 0; i--) {
        if (streaks[i].life <= 0) streaks.splice(i, 1);
    }

    // partículas
    particles.forEach(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= deltaTime;
    });
    for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // textos
    comboTexts.forEach(t => {
        t.y -= 0.7 * dt;
        t.life -= deltaTime;
    });
    for (let i = comboTexts.length - 1; i >= 0; i--) {
        if (comboTexts[i].life <= 0) comboTexts.splice(i, 1);
    }

    // timers
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
    if (screenShake > 0) {
        const dx = (Math.random() - 0.5) * screenShake;
        const dy = (Math.random() - 0.5) * screenShake;
        ctx.translate(dx, dy);
        screenShake *= 0.9;
        if (screenShake < 0.3) screenShake = 0;
    }

        // Micro-tilt: rotamos todo el mundo alrededor del centro
    ctx.save();
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(cameraTilt);
    ctx.translate(-cx, -cy);


    // Fondo principal (gradiente vertical)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    const midColor = getLevelTheme();
    bgGradient.addColorStop(0, "#05010a");
    bgGradient.addColorStop(0.35, midColor);
    bgGradient.addColorStop(1, "#05010a");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

        // Líneas suaves tipo scanline
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#111827";
    for (let y = 0; y < height; y += 8) {
        ctx.fillRect(0, y, width, 1);
    }
    ctx.restore();

        // 🔹 Motion Field Elegante (líneas largas, suaves, premium)
    ctx.save();

    const linesCount = 12;              // Menos líneas → más elegante
    const speed = 0.25;                 // Velocidad suave
    const spacing = height / linesCount;

    const levelFactor = 1 + (level - 1) * 0.08;
    const hardcoreFactor = hardcoreActive ? 1.25 : 1;
    const tMotion = (lastTime || 0) * speed * levelFactor * hardcoreFactor;

    ctx.globalAlpha = 0.11;             // Mucho más discreto

    for (let i = 0; i < linesCount; i++) {
        // Desplazamiento vertical animado
        const baseY = (i * spacing + tMotion) % (height + 150) - 75;

        // Líneas más inclinadas y largas
        const x1 = -120;
        const y1 = baseY + 80;
        const x2 = width + 120;
        const y2 = baseY - 80;

        // Gradiente mucho más sutil
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0.0, "rgba(15,23,42,0.0)");
        grad.addColorStop(0.40, "rgba(200,220,255,0.20)");
        grad.addColorStop(0.70, "rgba(200,220,255,0.08)");
        grad.addColorStop(1.0, "rgba(15,23,42,0.0)");

        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.9;           // Línea extremadamente fina
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.restore();


    // Estrellas en 3 capas (parallax sencillo)
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


    // Tint según powerups activos
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
        const alpha = Math.max(0, levelUpFlashTimer / 600) * 0.6;
        ctx.save();
        ctx.fillStyle = `rgba(129,140,248,${alpha})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    // Vignette para dar profundidad (bordes más oscuros)
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

// 🔹 Neblina suave estilo Hollow Knight
ctx.save();

const fogStartY = height * 0.55; // más abajo = más sutil

// Intensidad base + incremento por nivel
const fogBase = 0.04;                        
const fogExtra = Math.min(0.06, 0.02 * (level - 1)); 
const fogAlpha = fogBase + fogExtra;

const fogGradient = ctx.createLinearGradient(0, fogStartY, 0, height);
fogGradient.addColorStop(0, `rgba(0,0,0,0.0)`);
fogGradient.addColorStop(1, `rgba(0,0,0,${fogAlpha})`);

// Modo normal para integrarse sin quemar el fondo
ctx.globalCompositeOperation = "source-over";
ctx.fillStyle = fogGradient;
ctx.fillRect(0, fogStartY, width, height - fogStartY);

ctx.restore();



    // Trail del jugador (afterimage con bordes suaves)
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

    // Jugador (barra neon / nave con pulso y vibración leve)
    ctx.save();

    const t = (lastTime || 0);
    const pulse = 1 + 0.05 * Math.sin(t / 260);            // 5% de escala
    const wobble = hardcoreActive ? 1.5 * Math.sin(t / 90) : 0; // vibración leve en hardcore

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

    // Glow exterior
    ctx.shadowColor = shieldActive ? "#34d399" : "#22d3ee";
    ctx.shadowBlur = shieldActive ? 24 : 20;

    // Cuerpo principal
    ctx.fillStyle = playerGradient;
    drawRoundedRect(ctx, drawX, drawY, drawWidth, drawHeight, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Borde oscuro sutil
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

    // Franja central de luz
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

// Obstáculos con gradiente, volumen y BLOOM en dorados
obstacles.forEach(o => {
    const base = neonColors[o.type] || "#22d3ee";
    const isGold = o.type === "gold";
    const isDanger = o.type === "danger";

    ctx.save();

    // 🌟 BLOOM extra SOLO para bloques dorados
    if (isGold) {
        ctx.save();

        const cx = o.x + o.width / 2;
        const cy = o.y + o.height / 2;
        const radius = Math.max(o.width, o.height) * 0.9;

        // Bloom en modo aditivo para que se funda con el fondo
        ctx.globalCompositeOperation = "lighter";
        const bloomGradient = ctx.createRadialGradient(
            cx,
            cy,
            0,
            cx,
            cy,
            radius
        );
        bloomGradient.addColorStop(0, "rgba(254,249,195,0.85)"); // núcleo claro // "rgba(254,249,195,1.0)" → brillo muy fuerte - "rgba(254,249,195,0.4)" → bloom suave
        bloomGradient.addColorStop(0.5, "rgba(250,204,21,0.45)"); // halo medio
        bloomGradient.addColorStop(1, "rgba(250,204,21,0.0)");    // se esfuma

        ctx.fillStyle = bloomGradient;
        const pad = 12;
        ctx.fillRect(
            o.x - pad,
            o.y - pad,
            o.width + pad * 2,
            o.height + pad * 2
        );

        ctx.restore();
    }

    // 🎨 Gradiente vertical del bloque
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

    // Glow exterior (un poco más fuerte en dorados y peligro)
    ctx.shadowColor = base;
    ctx.shadowBlur = isDanger ? 22 : (isGold ? 20 : 16);

    // Cuerpo del bloque
    ctx.fillStyle = blockGradient;
    drawRoundedRect(ctx, o.x, o.y, o.width, o.height, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Línea inferior oscura para volumen
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

    // Borde exterior
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    drawRoundedRect(ctx, o.x + 0.5, o.y + 0.5, o.width - 1, o.height - 1, 7.5);
    ctx.stroke();

    ctx.restore();
});

    // Power-ups con halo y pulso
    powerups.forEach(p => {
        const isSlow = p.type === "slow";
        const baseColor = isSlow ? "#38bdf8" : "#34d399";
        const label = isSlow ? "⏱" : "🛡";
        const cx = p.x + p.width / 2;
        const cy = p.y + p.height / 2;
        const radius = p.width / 2;

        const t = (lastTime || 0) * 0.005;
        const pulse = 0.08 * Math.sin(t) + 0.15;

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
        haloGradient.addColorStop(0, `rgba(15,23,42,0.0)`);
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
        ctx.shadowBlur = 18;

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

    // partículas
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

    // streaks
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

    // textos flotantes
    comboTexts.forEach(tObj => {
        const alpha = Math.max(0, tObj.life / 800);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = tObj.color || "#e5e7eb";
        ctx.font = "18px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(tObj.text, tObj.x, tObj.y);
        ctx.restore();
    });

        // Fin del mundo rotado (el HUD queda sin inclinación)
    ctx.restore();

    // ---- HUD SUPERIOR ----
    const blinkSlow = slowMotionActive && slowMotionTimer <= 1200;
    const blinkShield = shieldActive && shieldTimer <= 1500;

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "rgba(15,23,42,0.96)";
    ctx.fillRect(0, 0, width, 58);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "left";
    drawTextWithStroke("Puntaje " + Math.floor(score), 20, 32, 22);
    drawTextWithStroke("Mejor " + Math.floor(bestScore), 20, 52, 14);
    ctx.restore();

    // Nivel (derecha) con highlight cuando subes de nivel
ctx.save();
ctx.textAlign = "right";

// ¿Estamos en animación de subida de nivel?
const isLevelHighlight = (gameState === "playing" && levelUpFlashTimer > 0);

// Tamaño y color dinámicos
const levelSize = isLevelHighlight ? 24 : 18;
const levelColor = isLevelHighlight ? "#fde047" : "#ffffff";

drawTextWithStroke("Nivel " + level, width - 20, 32, levelSize, levelColor);

// Flechita ↑ cuando está en highlight
if (isLevelHighlight) {
    drawTextWithStroke("↑", width - 20, 16, 14, "#facc15");
}

// Combo (debajo del nivel)
drawTextWithStroke("Combo x" + combo, width - 20, 52, 14);
ctx.restore();

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

    // ---- OVERLAYS DE ESTADO ----
    const centerX = width / 2;
    const centerY = height * 0.46;

        // 🔹 Banner de subida de nivel (más claro y entendible)
    if (gameState === "playing" && levelUpFlashTimer > 0) {
        // t va de 1 → 0 mientras se agota el timer
        const t = Math.max(0, levelUpFlashTimer / 1800);
        const alpha = 0.9 * t;
        const scale = 1 + 0.06 * (1 - t); // pequeño pop al aparecer

        const baseWidth = 260;
        const baseHeight = 70;
        const bannerWidth = baseWidth * scale;
        const bannerHeight = baseHeight * scale;

        const bx = centerX - bannerWidth / 2;
        const by = centerY - bannerHeight / 2 - 90; // un poco arriba del centro

        ctx.save();
        ctx.globalAlpha = alpha;

        // Fondo del banner
        ctx.fillStyle = "rgba(15,23,42,0.96)";
        drawRoundedRect(ctx, bx, by, bannerWidth, bannerHeight, 16);
        ctx.fill();

        // Borde con ligero gradiente morado/azul
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

        // Glow suave alrededor
        ctx.shadowColor = "#a5b4fc";
        ctx.shadowBlur = 18;

        // Título: ¡Nivel X!
        ctx.fillStyle = "#e5e7eb";
        ctx.textAlign = "center";
        ctx.font = "20px system-ui";
        ctx.fillText("¡Nivel " + level + "!", centerX, by + bannerHeight / 2 - 6);

        // Subtítulo: info breve
        ctx.shadowBlur = 0;
        ctx.font = "13px system-ui";
        ctx.fillStyle = "#9ca3af";
        ctx.fillText("Velocidad aumentada", centerX, by + bannerHeight / 2 + 14);

        ctx.restore();
    }

    // Pantalla de "READY"
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

    // Pantalla de GAME OVER
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

// loop
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    update(deltaTime);
    draw();

    requestAnimationFrame(gameLoop);
}

// Inicializar estrellas una vez antes de empezar el juego
initStars();

// Empezar loop
requestAnimationFrame(gameLoop);
