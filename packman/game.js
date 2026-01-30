const SUPABASE_URL = 'https://jbfvoxlcociwtyobaotz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiZnZveGxjb2Npd3R5b2Jhb3R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3OTQ3MTgsImV4cCI6MjA4MzM3MDcxOH0.ydY1I-rVv08Kg76wI6oPgAt9fhUMRZmsFxpc03BhmkA';

class SupabaseClient {
    async fetch(endpoint, options = {}) {
        const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                ...options.headers,
            },
        });
        
        const text = await response.text();
        if (!text) return null;
        
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error('JSON parse error:', text);
            return null;
        }
    }

    async getRooms() {
        return this.fetch('/rest/v1/rooms?status=in.(waiting,playing)&order=created_at.desc');
    }

    async getPlayers(roomId) {
        return this.fetch(`/rest/v1/players?room_id=eq.${roomId}&order=joined_at.asc`);
    }

    async getRoom(roomId) {
        const data = await this.fetch(`/rest/v1/rooms?id=eq.${roomId}`);
        return data && data[0];
    }

    async createRoom(name, hostName) {
        return this.fetch('/rest/v1/rooms', {
            method: 'POST',
            body: JSON.stringify({
                name,
                host_name: hostName,
                status: 'waiting',
                max_players: 2,
                player_count: 0
            }),
            headers: { 'Prefer': 'return=representation' }
        });
    }

    async createPlayer(roomId, name) {
        return this.fetch('/rest/v1/players', {
            method: 'POST',
            body: JSON.stringify({
                room_id: roomId,
                name,
                ready: false
            }),
            headers: { 'Prefer': 'return=representation' }
        });
    }

    async updateRoom(roomId, data) {
        return this.fetch(`/rest/v1/rooms?id=eq.${roomId}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    async updatePlayer(playerId, data) {
        return this.fetch(`/rest/v1/players?id=eq.${playerId}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    async deletePlayer(playerId) {
        return this.fetch(`/rest/v1/players?id=eq.${playerId}`, {
            method: 'DELETE'
        });
    }
}

const supabase = new SupabaseClient();

class Game {
    constructor() {
        this.screen = 'menu';
        this.playerName = this.loadPlayerName();
        this.playerId = null;
        this.rooms = [];
        this.currentRoom = null;
        this.players = [];
        this.isReady = false;
        this.countdown = null;
        this.pollInterval = null;
        
        this.render();
    }

    loadPlayerName() {
        return localStorage.getItem('playerName') || '';
    }

    savePlayerName(name) {
        localStorage.setItem('playerName', name);
        this.playerName = name;
    }

    async startPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        
        this.pollInterval = setInterval(async () => {
            if (this.screen === 'roomlist') {
                await this.cleanupData();
                await this.loadRooms();
            } else if (this.screen === 'room') {
                await this.loadPlayers();
                await this.checkRoomStatus();
            }
        }, 1000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async cleanupData() {
        try {
            await supabase.fetch('/rest/v1/rpc/cleanup_inactive_players', {
                method: 'POST'
            });
            await supabase.fetch('/rest/v1/rpc/cleanup_empty_rooms', {
                method: 'POST'
            });
        } catch (e) {
            // Tiché selhání
        }
    }

    async loadRooms() {
        this.rooms = await supabase.getRooms() || [];
        this.render();
    }

    async loadPlayers() {
        if (!this.currentRoom) return;
        this.players = await supabase.getPlayers(this.currentRoom.id) || [];
        
        if (this.playerId) {
            await supabase.updatePlayer(this.playerId, { 
                last_seen: new Date().toISOString()
            });
        }
        
        this.render();
    }

    async checkRoomStatus() {
        if (!this.currentRoom) return;
        const room = await supabase.getRoom(this.currentRoom.id);
        if (room && room.status === 'countdown' && this.countdown === null) {
            this.startCountdown();
        }
    }

    async createRoom() {
        try {
            const roomName = `${this.playerName}'s Room`;
            const roomData = await supabase.createRoom(roomName, this.playerName);
            
            if (!roomData || !roomData[0]) {
                alert('Chyba: Nelze vytvořit místnost!');
                return;
            }
            
            const room = roomData[0];
            const playerData = await supabase.createPlayer(room.id, this.playerName);
            
            if (!playerData || !playerData[0]) {
                alert('Chyba: Nelze vytvořit hráče!');
                return;
            }
            
            const player = playerData[0];

            await supabase.updateRoom(room.id, {
                host_id: player.id,
                player_count: 1
            });

            this.playerId = player.id;
            this.currentRoom = { ...room, host_id: player.id };
            this.screen = 'room';
            this.startPolling();
            this.render();
        } catch (error) {
            console.error('Create room error:', error);
            alert('Chyba při vytváření místnosti!');
        }
    }

    async joinRoom(room) {
        try {
            const playerData = await supabase.createPlayer(room.id, this.playerName);

            if (!playerData || !playerData[0]) {
                alert('Chyba: Nelze připojit hráče!');
                return;
            }

            const player = playerData[0];

            await supabase.updateRoom(room.id, {
                player_count: (room.player_count || 0) + 1
            });

            this.playerId = player.id;
            this.currentRoom = room;
            this.screen = 'room';
            this.startPolling();
            this.render();
        } catch (error) {
            console.error('Join room error:', error);
            alert('Chyba při připojování!');
        }
    }

    async leaveRoom() {
        if (this.playerId && this.currentRoom) {
            await supabase.deletePlayer(this.playerId);
            await supabase.updateRoom(this.currentRoom.id, {
                player_count: Math.max(0, (this.currentRoom.player_count || 1) - 1)
            });
        }
        this.playerId = null;
        this.currentRoom = null;
        this.screen = 'roomlist';
        this.render();
    }

    async toggleReady() {
        this.isReady = !this.isReady;
        await supabase.updatePlayer(this.playerId, { ready: this.isReady });
        this.render();
    }

    async startGame() {
        const allReady = this.players.every(p => p.ready || p.id === this.playerId);
        if (!allReady) return;

        await supabase.updateRoom(this.currentRoom.id, { status: 'countdown' });
    }

    startCountdown() {
        let count = 5;
        this.countdown = count;
        this.render();
        
        const timer = setInterval(() => {
            count--;
            this.countdown = count;
            this.render();
            
            if (count === 0) {
                clearInterval(timer);
                this.stopPolling();
                
                const isSolo = this.players.length === 1;
                
                let role;
                if (isSolo) {
                    role = 'pacman';
                } else {
                    const randomRole = Math.random() < 0.5 ? 'pacman' : 'ghost';
                    const playerIndex = this.players.findIndex(p => p.id === this.playerId);
                    role = (playerIndex === 0 ? randomRole : (randomRole === 'pacman' ? 'ghost' : 'pacman'));
                }
                
                window.location.href = `hra.html?room=${this.currentRoom.id}&player=${this.playerId}&role=${role}&solo=${isSolo}`;
            }
        }, 1000);
    }

    render() {
        const app = document.getElementById('app');
        
        if (this.screen === 'menu') {
            app.innerHTML = `
                <div class="center">
                    <div class="text-center">
                        <h1 class="title">💀 MAN EATER 💀</h1>
                        
                        ${!this.playerName ? `
                        <div class="input-group">
                            <input
                                id="playerNameInput"
                                type="text"
                                placeholder="Zadej své jméno..."
                                value="${this.playerName}"
                                maxlength="20"
                            />
                        </div>
                        <button id="saveNameBtn" class="btn btn-primary">
                            Uložit jméno
                        </button>
                        ` : `
                        <div style="margin-bottom: 2rem; color: #f87171; font-size: 1.3rem;">
                            Vítej, <span style="color: #fbbf24; font-weight: bold;">${this.playerName}</span>! 
                            <button id="changeNameBtn" style="margin-left: 1rem; padding: 0.3rem 0.8rem; background: #7f1d1d; color: #f87171; border: 1px solid #991b1b; border-radius: 0.5rem; cursor: pointer;">Změnit</button>
                        </div>
                        <div class="menu-buttons">
                            <button id="singleplayerBtn" class="btn btn-primary">
                                🎮 SINGLEPLAYER
                            </button>
                            <button id="multiplayerBtn" class="btn btn-primary">
                                👥 MULTIPLAYER
                            </button>
                            <button id="shopBtn" class="btn btn-primary">
                                🛒 OBCHOD
                            </button>
                            <button id="settingsBtn" class="btn btn-primary">
                                ⚙️ NASTAVENÍ
                            </button>
                            <button id="leaderboardBtn" class="btn btn-primary">
                                🏆 ŽEBŘÍČEK
                            </button>
                            <button id="guildBtn" class="btn btn-primary">
                                🛡️ GUILD
                            </button>
                        </div>
                        `}
                    </div>
                </div>
            `;
            
            if (!this.playerName) {
                const input = document.getElementById('playerNameInput');
                const btn = document.getElementById('saveNameBtn');
                
                input.addEventListener('input', (e) => {
                    btn.disabled = !e.target.value.trim();
                });
                
                btn.disabled = true;
                btn.addEventListener('click', () => {
                    if (input.value.trim()) {
                        this.savePlayerName(input.value.trim());
                        this.render();
                    }
                });
            } else {
                document.getElementById('changeNameBtn')?.addEventListener('click', () => {
                    this.playerName = '';
                    localStorage.removeItem('playerName');
                    this.render();
                });
                
                document.getElementById('singleplayerBtn')?.addEventListener('click', () => {
                    window.location.href = 'levels.html';
                });
                
                document.getElementById('multiplayerBtn')?.addEventListener('click', () => {
                    this.screen = 'roomlist';
                    this.startPolling();
                    this.loadRooms();
                });
                
                document.getElementById('shopBtn')?.addEventListener('click', () => {
                    window.location.href = 'shop.html';
                });
                
                document.getElementById('settingsBtn')?.addEventListener('click', () => {
                    window.location.href = 'nastaveni.html';
                });
                
                document.getElementById('leaderboardBtn')?.addEventListener('click', () => {
                    window.location.href = 'zebricek.html';
                });
                
                document.getElementById('guildBtn')?.addEventListener('click', () => {
                    window.location.href = 'guild.html';
                });
            }
        }
        else if (this.screen === 'roomlist') {
            app.innerHTML = `
                <div class="container">
                    <button id="backBtn" class="btn btn-secondary back-btn">
                        ← Zpět
                    </button>
                    
                    <h2 class="title text-center">💀 Herní Místnosti 💀</h2>
                    
                    <button id="createRoomBtn" class="btn btn-primary create-room-btn">
                        + Vytvořit novou místnost
                    </button>
                    
                    <div id="roomsList">
                        ${this.rooms.length === 0 ? 
                            '<div class="room-list-empty">Žádné aktivní místnosti</div>' :
                            this.rooms.map((room, index) => `
                                <div class="room-card">
                                    <div>
                                        <div class="room-title">${room.name}</div>
                                        <div class="room-info">
                                            Hráči: ${room.player_count || 0} / ${room.max_players}
                                            ${room.status === 'playing' ? ' (Ve hře)' : ''}
                                        </div>
                                        <div class="room-info" style="color: #fca5a5;">Vedoucí: ${room.host_name}</div>
                                    </div>
                                    <button
                                        class="btn btn-primary join-room-btn"
                                        data-room-index="${index}"
                                        ${room.status === 'playing' || (room.player_count || 0) >= room.max_players ? 'disabled' : ''}
                                    >
                                        ${room.status === 'playing' ? 'Ve hře' : 'Připojit se'}
                                    </button>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;
            
            document.getElementById('backBtn').addEventListener('click', () => {
                this.stopPolling();
                this.screen = 'menu';
                this.render();
            });
            
            document.getElementById('createRoomBtn').addEventListener('click', () => {
                this.stopPolling();
                this.createRoom();
            });
            
            document.querySelectorAll('.join-room-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const roomIndex = parseInt(btn.dataset.roomIndex);
                    const room = this.rooms[roomIndex];
                    this.stopPolling();
                    this.joinRoom(room);
                });
            });
        }
        else if (this.screen === 'room') {
            const isHost = this.currentRoom.host_id === this.playerId;
            
            app.innerHTML = `
                <div class="container">
                    <button id="leaveBtn" class="btn btn-secondary back-btn">
                        ← Opustit místnost
                    </button>
                    
                    <h2 class="title text-center">💀 ${this.currentRoom.name} 💀</h2>

                    <div class="lobby-content">
                        <h3 class="lobby-title">Hráči v místnosti (${this.players.length}/2)</h3>
                        
                        <div class="player-list">
                            ${this.players.map(player => `
                                <div class="player-item">
                                    <div class="player-name">
                                        <span>💀</span>
                                        <span>${player.name}</span>
                                        ${player.id === this.currentRoom.host_id ? '<span>👑</span>' : ''}
                                        ${this.players.findIndex(p => p.id === player.id) === 0 ? '<span>🟡</span>' : '<span>👻</span>'}
                                    </div>
                                    <span class="status-badge ${player.ready ? 'status-ready' : 'status-not-ready'}">
                                        ${player.ready ? 'READY' : 'Not Ready'}
                                    </span>
                                </div>
                            `).join('')}
                        </div>

                        <div class="button-group">
                            <button
                                id="readyBtn"
                                class="btn btn-primary btn-ready ${this.isReady ? 'active' : ''}"
                            >
                                ${this.isReady ? '✓ READY' : 'READY?'}
                            </button>

                            ${isHost ? `
                                <button
                                    id="startBtn"
                                    class="btn btn-primary"
                                    ${!this.players.every(p => p.ready || p.id === this.playerId) ? 'disabled' : ''}
                                >
                                    ${this.players.length === 1 ? 'HRÁT SOLO (s AI)' : 'SPUSTIT HRU'}
                                </button>
                            ` : ''}
                        </div>

                        ${this.players.length < 2 ? `
                            <div style="margin-top: 1rem; text-align: center; color: #f87171;">
                                ${isHost ? 'Můžeš hrát sám nebo počkat na druhého hráče...' : 'Čekáme na druhého hráče...'}
                            </div>
                        ` : ''}
                    </div>
                </div>

                ${this.countdown !== null ? `
                    <div class="countdown-overlay">
                        <div class="countdown-number">
                            ${this.countdown}
                        </div>
                    </div>
                ` : ''}
            `;
            
            document.getElementById('leaveBtn').addEventListener('click', () => {
                this.stopPolling();
                this.leaveRoom();
            });
            
            document.getElementById('readyBtn').addEventListener('click', () => {
                this.toggleReady();
            });
            
            if (isHost) {
                document.getElementById('startBtn')?.addEventListener('click', () => {
                    this.startGame();
                });
            }
        }
    }
}

new Game();
