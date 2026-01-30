const SUPABASE_URL = 'https://jbfvoxlcociwtyobaotz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiZnZveGxjb2Npd3R5b2Jhb3R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3OTQ3MTgsImV4cCI6MjA4MzM3MDcxOH0.ydY1I-rVv08Kg76wI6oPgAt9fhUMRZmsFxpc03BhmkA';

const TILE_SIZE = 25;
const MAZE_WIDTH = 28;
const MAZE_HEIGHT = 31;

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const playerId = urlParams.get('player');
let playerRole = urlParams.get('role');
const isSoloMode = urlParams.get('solo') === 'true';

// Pac-Man level
const maze = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "######.##### ## #####.######",
    "######.##          ##.######",
    "######.## ###--### ##.######",
    "######.## #      # ##.######",
    "      .   #      #   .      ",
    "######.## #      # ##.######",
    "######.## ######## ##.######",
    "######.##          ##.######",
    "######.## ######## ##.######",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##.......  .......##..o#",
    "###.##.##.########.##.##.###",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################"
];

const GHOST_TYPES = {
    BLINKY: 'blinky',
    PINKY: 'pinky',
    INKY: 'inky',
    CLYDE: 'clyde'
};

class PacManGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = MAZE_WIDTH * TILE_SIZE;
        this.canvas.height = MAZE_HEIGHT * TILE_SIZE;

        this.soloMode = isSoloMode;
        this.score = 0;
        this.level = 1;
        this.gameOver = false;
        this.ghostCooldown = 0;
        this.cooldownInterval = null;
        this.animationFrame = 0;
        this.realtimeChannel = null;
        this.lastUpdateTime = Date.now();
        this.otherPlayerData = null;
        this.roomPlayers = {}; // Seznam hráčů v místnosti
        this.roleAssigned = false;

        this.pacman = { 
            x: 14, 
            y: 23, 
            direction: { x: 0, y: 0 },
            nextDirection: { x: 0, y: 0 },
            mouthAngle: 0.2,
            mouthOpen: true
        };
        
        const ghostConfigs = [
            { color: '#FF0000', type: GHOST_TYPES.BLINKY, name: 'Blinky' },
            { color: '#FFB8FF', type: GHOST_TYPES.PINKY, name: 'Pinky' },
            { color: '#00FFFF', type: GHOST_TYPES.INKY, name: 'Inky' },
            { color: '#FFB852', type: GHOST_TYPES.CLYDE, name: 'Clyde' }
        ];
        
        this.ghosts = ghostConfigs.map((config, index) => ({
            x: 13 + index,
            y: 14,
            color: config.color,
            type: config.type,
            name: config.name,
            direction: { x: 0, y: 0 },
            isAI: this.soloMode ? true : (index !== 0),
            isPlayer: !this.soloMode && index === 0,
            animOffset: index * 20,
            scatterMode: false,
            scatterTarget: this.getScatterTarget(config.type)
        }));
        
        this.dots = [];
        this.powerPellets = [];

        this.initMaze();
        this.initializeGame();
    }

    async initializeGame() {
        console.log('🎮 Inicializace hry...');
        
        // V multiplayeru nastavíme realtime a přiřadíme role
        if (!this.soloMode) {
            await this.setupRealtimeAndAssignRole();
            
            // Počkáme na přiřazení role (max 5 sekund)
            let attempts = 0;
            while (!this.roleAssigned && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (!this.roleAssigned) {
                alert('Nepodařilo se připojit k místnosti. Zkus to znovu.');
                window.location.href = 'index.html';
                return;
            }
        } else {
            this.role = playerRole;
            this.roleAssigned = true;
        }
        
        console.log('✅ Role přiřazena:', this.role);
        
        this.setupControls();
        this.startGame();
        this.startCooldownTimer();

        const roleText = this.role === 'pacman' 
            ? (this.soloMode ? '🟡 Pac-Man (SOLO)' : '🟡 Pac-Man')
            : '👻 Ghost';
        document.getElementById('roleDisplay').textContent = roleText;

        const controlsText = this.role === 'pacman' 
            ? '🟡 Pac-Man: ← → ↑ ↓'
            : '👻 Ghost: W A S D';
        document.getElementById('controlsText').textContent = controlsText;

        const spawnBtn = document.getElementById('spawnGhostBtn');
        if (this.role === 'ghost') {
            spawnBtn.addEventListener('click', () => this.spawnGhost());
        } else {
            spawnBtn.style.display = 'none';
            document.getElementById('cooldownText').style.display = 'none';
        }

        document.getElementById('exitBtn').addEventListener('click', () => {
            this.leaveRoom();
        });

        document.getElementById('backToLobbyBtn').addEventListener('click', () => {
            this.leaveRoom();
        });
    }

    async setupRealtimeAndAssignRole() {
        try {
            console.log('📡 Připojování k Realtime...');
            
            const { createClient } = window.supabase;
            const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            
            this.realtimeChannel = supabase.channel(`room:${roomId}`, {
                config: {
                    broadcast: { self: true }
                }
            });
            
            // Posloucháme role updates
            this.realtimeChannel
                .on('broadcast', { event: 'role_claim' }, (payload) => {
                    console.log('📨 Přijata role claim:', payload);
                    const data = payload.payload;
                    
                    if (data.playerId !== playerId) {
                        // Někdo jiný si vzal roli
                        this.roomPlayers[data.playerId] = data.role;
                        
                        // Pokud ještě nemáme roli, přiřadíme si opačnou
                        if (!this.roleAssigned) {
                            this.role = data.role === 'pacman' ? 'ghost' : 'pacman';
                            this.roleAssigned = true;
                            console.log('✅ Přiřazena opačná role:', this.role);
                        }
                    }
                })
                .on('broadcast', { event: 'player_update' }, (payload) => {
                    if (payload.payload.playerId !== playerId) {
                        this.otherPlayerData = payload.payload;
                        this.updateOtherPlayer();
                    }
                })
                .subscribe(async (status) => {
                    console.log('📡 Realtime status:', status);
                    
                    if (status === 'SUBSCRIBED') {
                        // Zkontrolujeme jestli už někdo nemá roli
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        if (!this.roleAssigned) {
                            // Pokud jsme první, nebo nikdo nemá naši preferovanou roli
                            const existingRoles = Object.values(this.roomPlayers);
                            
                            if (existingRoles.length === 0) {
                                // Jsme první - vezmeme si preferovanou roli
                                this.role = playerRole || 'pacman';
                            } else if (!existingRoles.includes('pacman')) {
                                this.role = 'pacman';
                            } else if (!existingRoles.includes('ghost')) {
                                this.role = 'ghost';
                            } else {
                                // Obě role obsazené
                                alert('Místnost je plná! Obě role jsou obsazené.');
                                window.location.href = 'index.html';
                                return;
                            }
                            
                            this.roleAssigned = true;
                            console.log('✅ Vzali jsme si roli:', this.role);
                            
                            // Oznámíme ostatním naši roli
                            await this.realtimeChannel.send({
                                type: 'broadcast',
                                event: 'role_claim',
                                payload: {
                                    playerId: playerId,
                                    role: this.role
                                }
                            });
                        }
                    }
                });
                
        } catch (error) {
            console.error('❌ Chyba při nastavení Realtime:', error);
            alert('Nepodařilo se připojit k místnosti. Zkus to znovu.');
            window.location.href = 'index.html';
        }
    }

    updateOtherPlayer() {
        if (!this.otherPlayerData) return;
        
        const data = this.otherPlayerData;
        
        if (data.role === 'pacman' && this.role === 'ghost') {
            // Aktualizujeme pozici Pac-Mana od druhého hráče
            this.pacman.x = data.x;
            this.pacman.y = data.y;
            this.pacman.direction = data.direction;
        } else if (data.role === 'ghost' && this.role === 'pacman') {
            // Aktualizujeme pozici ducha druhého hráče
            const playerGhost = this.ghosts.find(g => g.isPlayer);
            if (playerGhost) {
                playerGhost.x = data.x;
                playerGhost.y = data.y;
                playerGhost.direction = data.direction;
            }
        }
    }

    async broadcastPosition() {
        if (!this.realtimeChannel || this.soloMode || !this.roleAssigned) return;
        
        // Posíláme pouze každých 100ms
        const now = Date.now();
        if (now - this.lastUpdateTime < 100) return;
        this.lastUpdateTime = now;
        
        let data = {
            playerId: playerId,
            role: this.role,
            x: 0,
            y: 0,
            direction: { x: 0, y: 0 }
        };
        
        if (this.role === 'pacman') {
            data.x = this.pacman.x;
            data.y = this.pacman.y;
            data.direction = this.pacman.direction;
        } else if (this.role === 'ghost') {
            const playerGhost = this.ghosts.find(g => g.isPlayer);
            if (playerGhost) {
                data.x = playerGhost.x;
                data.y = playerGhost.y;
                data.direction = playerGhost.direction;
            }
        }
        
        await this.realtimeChannel.send({
            type: 'broadcast',
            event: 'player_update',
            payload: data
        });
    }

    leaveRoom() {
        if (this.realtimeChannel) {
            this.realtimeChannel.unsubscribe();
        }
        window.location.href = 'index.html';
    }

    getScatterTarget(type) {
        switch(type) {
            case GHOST_TYPES.BLINKY: return { x: 25, y: 1 };
            case GHOST_TYPES.PINKY: return { x: 2, y: 1 };
            case GHOST_TYPES.INKY: return { x: 25, y: 29 };
            case GHOST_TYPES.CLYDE: return { x: 2, y: 29 };
            default: return { x: 14, y: 14 };
        }
    }

    initMaze() {
        for (let y = 0; y < maze.length; y++) {
            for (let x = 0; x < maze[y].length; x++) {
                if (maze[y][x] === '.') {
                    this.dots.push({ x, y });
                } else if (maze[y][x] === 'o') {
                    this.powerPellets.push({ x, y });
                }
            }
        }
        this.updateDotsDisplay();
    }

    setupControls() {
        document.addEventListener('keydown', (e) => {
            if (this.gameOver || !this.roleAssigned) return;

            if (this.role === 'pacman') {
                if (e.key === 'ArrowLeft') this.pacman.nextDirection = { x: -1, y: 0 };
                if (e.key === 'ArrowRight') this.pacman.nextDirection = { x: 1, y: 0 };
                if (e.key === 'ArrowUp') this.pacman.nextDirection = { x: 0, y: -1 };
                if (e.key === 'ArrowDown') this.pacman.nextDirection = { x: 0, y: 1 };
            }
            
            if (this.role === 'ghost') {
                const playerGhost = this.ghosts.find(g => g.isPlayer);
                if (playerGhost) {
                    if (e.key === 'a' || e.key === 'A') this.moveGhost(playerGhost, -1, 0);
                    if (e.key === 'd' || e.key === 'D') this.moveGhost(playerGhost, 1, 0);
                    if (e.key === 'w' || e.key === 'W') this.moveGhost(playerGhost, 0, -1);
                    if (e.key === 's' || e.key === 'S') this.moveGhost(playerGhost, 0, 1);
                }
            }
        });
    }

    startGame() {
        setInterval(() => {
            if (!this.gameOver && this.roleAssigned) {
                this.animationFrame++;
                this.update();
                this.draw();
                this.broadcastPosition();
            }
        }, 150);
    }

    startCooldownTimer() {
        this.cooldownInterval = setInterval(() => {
            if (this.ghostCooldown > 0) {
                this.ghostCooldown--;
                this.updateCooldownDisplay();
            }
        }, 1000);
    }

    update() {
        if (this.role === 'pacman') {
            this.movePacman();
            this.checkDotCollision();
            
            if (this.animationFrame % 3 === 0) {
                this.pacman.mouthOpen = !this.pacman.mouthOpen;
                this.pacman.mouthAngle = this.pacman.mouthOpen ? 0.2 : 0.05;
            }
        }
        
        for (const ghost of this.ghosts) {
            if (ghost.isAI) {
                this.moveGhostAI(ghost);
            }
        }
        
        this.checkGhostCollision();
    }

    movePacman() {
        const nextX = this.pacman.x + this.pacman.nextDirection.x;
        const nextY = this.pacman.y + this.pacman.nextDirection.y;
        
        if (this.isWalkable(nextX, nextY)) {
            this.pacman.direction = { ...this.pacman.nextDirection };
        }

        const newX = this.pacman.x + this.pacman.direction.x;
        const newY = this.pacman.y + this.pacman.direction.y;

        if (this.isWalkable(newX, newY)) {
            this.pacman.x = newX;
            this.pacman.y = newY;

            if (this.pacman.x < 0) this.pacman.x = MAZE_WIDTH - 1;
            if (this.pacman.x >= MAZE_WIDTH) this.pacman.x = 0;
        }
    }

    moveGhost(ghost, dx, dy) {
        const newX = ghost.x + dx;
        const newY = ghost.y + dy;

        if (this.isWalkable(newX, newY)) {
            ghost.x = newX;
            ghost.y = newY;
            ghost.direction = { x: dx, y: dy };
        }
    }

    moveGhostAI(ghost) {
        const directions = [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: -1 },
            { x: 0, y: 1 }
        ];

        let target;
        
        switch(ghost.type) {
            case GHOST_TYPES.BLINKY:
                target = { x: this.pacman.x, y: this.pacman.y };
                break;
                
            case GHOST_TYPES.PINKY:
                target = {
                    x: this.pacman.x + this.pacman.direction.x * 4,
                    y: this.pacman.y + this.pacman.direction.y * 4
                };
                break;
                
            case GHOST_TYPES.INKY:
                const blinky = this.ghosts.find(g => g.type === GHOST_TYPES.BLINKY);
                const ahead = {
                    x: this.pacman.x + this.pacman.direction.x * 2,
                    y: this.pacman.y + this.pacman.direction.y * 2
                };
                if (blinky) {
                    target = {
                        x: ahead.x + (ahead.x - blinky.x),
                        y: ahead.y + (ahead.y - blinky.y)
                    };
                } else {
                    target = ahead;
                }
                break;
                
            case GHOST_TYPES.CLYDE:
                const dist = Math.abs(this.pacman.x - ghost.x) + Math.abs(this.pacman.y - ghost.y);
                if (dist < 8) {
                    target = ghost.scatterTarget;
                } else {
                    target = { x: this.pacman.x, y: this.pacman.y };
                }
                break;
                
            default:
                target = { x: this.pacman.x, y: this.pacman.y };
        }

        let bestDir = ghost.direction;
        let bestDist = Infinity;

        for (const dir of directions) {
            if (dir.x === -ghost.direction.x && dir.y === -ghost.direction.y) continue;
            
            const newX = ghost.x + dir.x;
            const newY = ghost.y + dir.y;

            if (this.isWalkable(newX, newY)) {
                const dist = Math.abs(target.x - newX) + Math.abs(target.y - newY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestDir = dir;
                }
            }
        }

        this.moveGhost(ghost, bestDir.x, bestDir.y);
    }

    isWalkable(x, y) {
        if (x < 0 || x >= MAZE_WIDTH || y < 0 || y >= MAZE_HEIGHT) return true;
        const cell = maze[y][x];
        return cell !== '#';
    }

    checkDotCollision() {
        for (let i = this.dots.length - 1; i >= 0; i--) {
            const dot = this.dots[i];
            if (dot.x === this.pacman.x && dot.y === this.pacman.y) {
                this.dots.splice(i, 1);
                this.score += 10;
                this.updateScore();
                this.updateDotsDisplay();
            }
        }

        for (let i = this.powerPellets.length - 1; i >= 0; i--) {
            const pellet = this.powerPellets[i];
            if (pellet.x === this.pacman.x && pellet.y === this.pacman.y) {
                this.powerPellets.splice(i, 1);
                this.score += 50;
                this.updateScore();
                this.updateDotsDisplay();
            }
        }

        if (this.dots.length === 0 && this.powerPellets.length === 0) {
            this.nextLevel();
        }
    }

    nextLevel() {
        this.level++;
        document.getElementById('level').textContent = `Level: ${this.level}`;
        this.score += 1000;
        this.initMaze();
        
        this.pacman.x = 14;
        this.pacman.y = 23;
        this.pacman.direction = { x: 0, y: 0 };
        this.pacman.nextDirection = { x: 0, y: 0 };
        
        for (let i = 0; i < this.ghosts.length; i++) {
            this.ghosts[i].x = 13 + i;
            this.ghosts[i].y = 14;
            this.ghosts[i].direction = { x: 0, y: 0 };
        }
        
        alert(`🎉 Level ${this.level}! 🎉`);
    }

    checkGhostCollision() {
        for (const ghost of this.ghosts) {
            if (ghost.x === this.pacman.x && ghost.y === this.pacman.y) {
                this.endGame('💀 GAME OVER 💀');
                return;
            }
        }
    }

    spawnGhost() {
        if (this.role !== 'ghost' || this.ghostCooldown > 0) return;

        const colors = ['#FF1493', '#00FF00', '#FFFF00', '#FF8C00', '#8A2BE2'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        this.ghosts.push({ 
            x: 13 + (this.ghosts.length % 4), 
            y: 14,
            color, 
            type: GHOST_TYPES.BLINKY,
            name: 'Extra',
            direction: { x: 0, y: 0 },
            isAI: true,
            isPlayer: false,
            animOffset: this.ghosts.length * 20,
            scatterMode: false,
            scatterTarget: { x: 14, y: 14 }
        });
        
        this.ghostCooldown = 10;
        this.updateGhostCount();
        this.updateCooldownDisplay();
    }

    updateScore() {
        document.getElementById('score').textContent = this.score;
    }

    updateDotsDisplay() {
        document.getElementById('dotsRemaining').textContent = 
            `Dots: ${this.dots.length + this.powerPellets.length}`;
    }

    updateGhostCount() {
        document.getElementById('ghostCount').textContent = 
            `Duchové: ${this.ghosts.length}`;
    }

    updateCooldownDisplay() {
        const btn = document.getElementById('spawnGhostBtn');
        const text = document.getElementById('cooldownText');
        
        if (this.role !== 'ghost') return;
        
        if (this.ghostCooldown > 0) {
            btn.disabled = true;
            text.textContent = `Cooldown: ${this.ghostCooldown}s`;
        } else {
            btn.disabled = false;
            text.textContent = '';
        }
    }

    async endGame(message) {
        this.gameOver = true;
        clearInterval(this.cooldownInterval);

        if (this.realtimeChannel) {
            this.realtimeChannel.unsubscribe();
        }

        if (this.soloMode) {
            await this.saveSingleplayerScore();
        } else {
            await this.saveMultiplayerScore(message);
        }

        document.getElementById('gameOver').style.display = 'flex';
        document.getElementById('gameOverTitle').textContent = message;
        document.getElementById('gameOverScore').textContent = `Skóre: ${this.score} | Level: ${this.level}`;
    }

    async saveSingleplayerScore() {
        try {
            const playerName = localStorage.getItem('playerName') || 'Guest';
            await fetch(`${SUPABASE_URL}/rest/v1/singleplayer_scores`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    player_name: playerName,
                    score: this.score,
                    level: this.level
                })
            });
        } catch (e) {
            console.error('Error saving score:', e);
        }
    }

    async saveMultiplayerScore(message) {
        try {
            const playerName = localStorage.getItem('playerName') || 'Guest';
            await fetch(`${SUPABASE_URL}/rest/v1/multiplayer_scores`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    player_name: playerName,
                    score: this.score,
                    wins: message.includes('VÝHRA') ? 1 : 0
                })
            });
        } catch (e) {
            console.error('Error saving score:', e);
        }
    }

    draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        for (let y = 0; y < maze.length; y++) {
            for (let x = 0; x < maze[y].length; x++) {
                if (maze[y][x] === '#') {
                    const gradient = this.ctx.createLinearGradient(
                        x * TILE_SIZE, y * TILE_SIZE,
                        x * TILE_SIZE + TILE_SIZE, y * TILE_SIZE + TILE_SIZE
                    );
                    gradient.addColorStop(0, '#0000aa');
                    gradient.addColorStop(0.5, '#0000ff');
                    gradient.addColorStop(1, '#0000aa');
                    
                    this.ctx.fillStyle = gradient;
                    this.ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    
                    this.ctx.strokeStyle = '#000088';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                }
            }
        }

        this.ctx.fillStyle = '#ffb897';
        for (const dot of this.dots) {
            this.ctx.beginPath();
            this.ctx.arc(
                dot.x * TILE_SIZE + TILE_SIZE / 2,
                dot.y * TILE_SIZE + TILE_SIZE / 2,
                2,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
        }

        const pelletSize = 5 + Math.sin(this.animationFrame * 0.2) * 1.5;
        this.ctx.fillStyle = '#fff';
        for (const pellet of this.powerPellets) {
            this.ctx.beginPath();
            this.ctx.arc(
                pellet.x * TILE_SIZE + TILE_SIZE / 2,
                pellet.y * TILE_SIZE + TILE_SIZE / 2,
                pelletSize,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
        }

        this.ctx.save();
        const pmCenterX = this.pacman.x * TILE_SIZE + TILE_SIZE / 2;
        const pmCenterY = this.pacman.y * TILE_SIZE + TILE_SIZE / 2;
        
        this.ctx.translate(pmCenterX, pmCenterY);
        
        let rotation = 0;
        if (this.pacman.direction.x === 1) rotation = 0;
        else if (this.pacman.direction.x === -1) rotation = Math.PI;
        else if (this.pacman.direction.y === -1) rotation = -Math.PI / 2;
        else if (this.pacman.direction.y === 1) rotation = Math.PI / 2;
        
        this.ctx.rotate(rotation);
        
        const pacGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, TILE_SIZE / 2);
        pacGradient.addColorStop(0, '#FFFF00');
        pacGradient.addColorStop(0.7, '#FFDD00');
        pacGradient.addColorStop(1, '#FFB000');
        
        this.ctx.fillStyle = pacGradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, TILE_SIZE / 2 - 2, this.pacman.mouthAngle * Math.PI, (2 - this.pacman.mouthAngle) * Math.PI);
        this.ctx.lineTo(0, 0);
        this.ctx.fill();
        
        if (this.pacman.direction.x !== 0 || this.pacman.direction.y !== 0) {
            this.ctx.fillStyle = '#000';
            this.ctx.beginPath();
            this.ctx.arc(3, -6, 2.5, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        this.ctx.restore();

        for (const ghost of this.ghosts) {
            const gCenterX = ghost.x * TILE_SIZE + TILE_SIZE / 2;
            const gCenterY = ghost.y * TILE_SIZE + TILE_SIZE / 2;
            
            const waveOffset = Math.sin((this.animationFrame + ghost.animOffset) * 0.3) * 2;
            
            this.ctx.fillStyle = ghost.color;
            
            this.ctx.beginPath();
            this.ctx.arc(gCenterX, gCenterY - 3 + waveOffset, TILE_SIZE / 2 - 2, Math.PI, 0);
            
            const bottomY = ghost.y * TILE_SIZE + TILE_SIZE - 2;
            this.ctx.lineTo(ghost.x * TILE_SIZE + TILE_SIZE - 2, bottomY + waveOffset);
            
            for (let i = 0; i < 3; i++) {
                const waveX = ghost.x * TILE_SIZE + TILE_SIZE - 2 - (i * (TILE_SIZE - 4) / 3);
                const waveY = bottomY + waveOffset - (i % 2 === 0 ? 3 : 0);
                this.ctx.lineTo(waveX, waveY);
            }
            
            this.ctx.lineTo(ghost.x * TILE_SIZE + 2, bottomY + waveOffset);
            this.ctx.closePath();
            this.ctx.fill();

            const eyeBlink = Math.sin(this.animationFrame * 0.5 + ghost.animOffset) > 0.9;
            const eyeHeight = eyeBlink ? 2 : 4;
            
            this.ctx.fillStyle = '#fff';
            this.ctx.fillRect(ghost.x * TILE_SIZE + 6, ghost.y * TILE_SIZE + 8, 4, eyeHeight);
            this.ctx.fillRect(ghost.x * TILE_SIZE + 15, ghost.y * TILE_SIZE + 8, 4, eyeHeight);
            
            if (!eyeBlink) {
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(ghost.x * TILE_SIZE + 7, ghost.y * TILE_SIZE + 9, 2, 2);
                this.ctx.fillRect(ghost.x * TILE_SIZE + 16, ghost.y * TILE_SIZE + 9, 2, 2);
            }
            
            if (ghost.isPlayer) {
                this.ctx.fillStyle = '#fbbf24';
                this.ctx.font = 'bold 12px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('👑', gCenterX, ghost.y * TILE_SIZE - 5);
            }
        }
    }
}

if (!playerId) {
    alert('Chybí parametry hry!');
    window.location.href = 'index.html';
} else {
    new PacManGame();
}
