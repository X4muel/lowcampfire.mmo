require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises; // Para ler o weapon_stats.json

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Permitir todas as origens para desenvolvimento. Em produção, restrinja à sua URL do Render.
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('ERRO: Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas. Verifique seu arquivo .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false
    }
});

let globalItemDefinitions = {}; // Todos os itens do banco de dados (tabela 'items')
let globalWeaponStats = {}; // Carregado do weapon_stats.json

async function loadGlobalItemDefinitions() {
    try {
        const { data, error } = await supabase
            .from('items')
            .select('*');

        if (error) {
            console.error('Erro ao carregar definições de itens do Supabase:', error.message);
        } else {
            console.log(`Carregadas ${data.length} definições de itens do Supabase.`);
            globalItemDefinitions = data.reduce((acc, item) => {
                acc[item.id] = item; // Mapeia por ID
                return acc;
            }, {});
        }
    } catch (err) {
        console.error('Erro inesperado ao carregar definições de itens:', err.message);
    }
}

async function loadGlobalWeaponStats() {
    try {
        const weaponStatsPath = path.join(__dirname, '../data/weapon_stats.json');
        const data = await fs.readFile(weaponStatsPath, 'utf8');
        globalWeaponStats = JSON.parse(data);
        console.log('Definições de estatísticas de armas carregadas do arquivo:', globalWeaponStats);
    } catch (err) {
        console.error('Erro ao carregar weapon_stats.json:', err.message);
    }
}

async function testSupabaseConnection() {
    try {
        const { data, error } = await supabase
            .from('players')
            .select('*')
            .limit(1);

        if (error) {
            console.error('Erro ao conectar ou consultar o Supabase (players):', error.message);
            if (error.code === '42P01' && error.message.includes('relation "players" does not exist')) {
                console.warn('AVISO: A tabela "players" ainda não existe no Supabase. Por favor, crie-a no painel do Supabase.');
            }
        } else {
            console.log('Conectado ao Supabase com sucesso (players)!');
        }
    } catch (err) {
        console.error('Erro inesperado ao conectar ao Supabase:', err.message);
    }

    await loadGlobalItemDefinitions();
    await loadGlobalWeaponStats(); // Carrega as estatísticas das armas
}

testSupabaseConnection();

// Mapa de jogadores conectados: { socket.id: { playerId: uuid, username: string, x: number, y: number, life: number, life_max: number, inventory: [], equippedItem: id } }
const connectedPlayers = {};

app.use(express.json());

// Função para inserir um novo perfil de jogador na tabela 'players'
async function insertPlayerProfile(userId, username, email) {
    try {
        const { data, error } = await supabase
            .from('players')
            .insert([
                { id: userId, username: username, email: email, x_pos: 0, y_pos: 0, money: 0, life: 10, life_max: 10 } // Adicionado life e life_max
            ])
            .select();

        if (error) {
            console.error('Erro ao inserir perfil do jogador no Supabase:', error.message);
            return null;
        }
        console.log('Perfil do jogador criado com sucesso no Supabase:', data[0]);
        return data[0];
    } catch (error) {
        console.error('Erro inesperado ao inserir perfil do jogador:', error.message);
        return null;
    }
}

// Função para carregar o perfil do jogador
async function loadPlayerProfile(playerId) {
    try {
        const { data: playerProfiles, error } = await supabase
            .from('players')
            .select('*')
            .eq('id', playerId)
            .limit(1);

        if (error) {
            console.error('Erro Supabase ao carregar perfil do jogador:', error.message);
            return null;
        }
        const playerProfile = playerProfiles && playerProfiles.length > 0 ? playerProfiles[0] : null;

        if (!playerProfile) {
            console.warn(`Perfil do jogador com ID ${playerId} não encontrado.`);
            return null;
        }
        console.log(`Perfil do jogador ${playerId} carregado:`, playerProfile);
        return playerProfile;
    } catch (error) {
        console.error('Erro inesperado ao carregar perfil do jogador:', error.message);
        return null;
    }
}

// Função para carregar o inventário de um jogador
async function loadPlayerInventory(playerId) {
    try {
        const { data, error } = await supabase
            .from('player_inventory')
            .select('*')
            .eq('player_id', playerId);

        if (error) {
            console.error('Erro ao carregar inventário do jogador:', error.message);
            return [];
        }
        return data;
    } catch (err) {
        console.error('Erro inesperado ao carregar inventário:', err.message);
        return [];
    }
}

app.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, senha e nome de usuário são obrigatórios.' });
    }

    try {
        const { data: existingPlayers, error: existingPlayerError } = await supabase
            .from('players')
            .select('id')
            .eq('username', username);

        if (existingPlayerError) {
            console.error('Erro ao verificar username existente:', existingPlayerError.message);
            return res.status(500).json({ error: 'Erro interno ao verificar username.' });
        }
        if (existingPlayers && existingPlayers.length > 0) {
            return res.status(409).json({ error: 'Nome de usuário já existe. Por favor, escolha outro.' });
        }

        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username: username // Garante que o username é passado para o metadata do Auth
                }
            }
        });

        if (authError) {
            console.error('Erro no signup do Supabase Auth:', authError.message);
            return res.status(400).json({ error: authError.message });
        }

        const user = authData.user;
        if (!user) {
            return res.status(500).json({ error: 'Erro inesperado no registro do usuário.' });
        }

        let playerProfile = await loadPlayerProfile(user.id);
        if (!playerProfile) {
            playerProfile = await insertPlayerProfile(user.id, username, email); // Usa o username diretamente do req.body
        } else {
            console.log('Perfil do jogador já existe, não recriando.');
        }

        if (!playerProfile) {
            console.error('Falha ao criar perfil do jogador após registro Auth. Verifique logs.');
            return res.status(500).json({ error: 'Registro bem-sucedido no Auth, mas falha ao criar perfil do jogador. Verifique logs do servidor e RLS/restrições de tabela.' });
        }

        console.log('Novo usuário e jogador registrados:', user.id, username);
        res.status(200).json({ message: 'Registro bem-sucedido! Por favor, faça login.', user: user, player: playerProfile });
    } catch (err) {
        console.error('Erro inesperado durante o signup:', err.message);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError) {
            console.error('Erro no login do Supabase Auth:', authError.message);
            return res.status(401).json({ error: authError.message });
        }

        const user = authData.user;
        if (!user) {
            return res.status(401).json({ error: 'Login falhou, usuário não encontrado.' });
        }

        const playerProfile = await loadPlayerProfile(user.id);

        if (!playerProfile) {
            console.warn(`Perfil do jogador para ID ${user.id} não encontrado na tabela 'players' após login. Tentando criar.`);
            // Fallback robusto para o username
            const usernameToUse = (user.user_metadata && user.user_metadata.username)
                                 ? user.user_metadata.username
                                 : user.email.split('@')[0]; // Usa a parte do email antes do '@' como fallback

            const newProfile = await insertPlayerProfile(user.id, usernameToUse, user.email);
            if (newProfile) {
                console.log('Perfil do jogador criado on-the-fly após login.');
                return res.status(200).json({ message: 'Login bem-sucedido. Perfil do jogador criado.', user: user, player: newProfile });
            } else {
                return res.status(500).json({ error: 'Erro ao carregar/criar perfil do jogador. Verifique RLS e restrições da tabela players.' });
            }
        }
        res.status(200).json({ message: 'Login bem-sucedido!', user: user, player: playerProfile });

    } catch (err) {
        console.error('Erro inesperado durante o login:', err.message);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// Middleware para servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../client')));

// NOVO: Servir assets da pasta 'assets'
app.use('/assets', express.static(path.join(__dirname, '../client/assets')));


// Lógica do Socket.io
io.on('connection', async (socket) => {
    console.log('Um jogador conectou:', socket.id);

    // Envia definições de itens e armas imediatamente para o cliente
    socket.emit('globalItemDefinitions', globalItemDefinitions);
    socket.emit('globalWeaponStats', globalWeaponStats); // Envia weapon_stats
    console.log('Definições de itens e armas enviadas para o novo cliente.');

    // NOVO: Quando um jogador loga e o cliente envia seu ID, atualize o estado no servidor
    socket.on('playerLoggedIn', async (playerId) => {
        if (!playerId) {
            console.warn(`playerLoggedIn: Player ID é nulo para socket ${socket.id}`);
            return;
        }

        const playerProfile = await loadPlayerProfile(playerId);
        if (playerProfile) {
            // Adiciona o jogador ao registro global
            connectedPlayers[socket.id] = {
                socketId: socket.id,
                playerId: playerId,
                username: playerProfile.username,
                x_pos: playerProfile.x_pos,
                y_pos: playerProfile.y_pos,
                life: playerProfile.life,
                life_max: playerProfile.life_max,
                inventory: await loadPlayerInventory(playerId), // Carrega inventário ao conectar
                equippedItem: null // Definir item equipado padrão, se houver
            };
            console.log(`Socket ${socket.id} associado ao Player ID: ${playerId} (${playerProfile.username})`);

            // Envia o estado atual do jogador recém-logado para ele mesmo
            socket.emit('playerStateUpdate', connectedPlayers[socket.id]);

            // Envia todos os jogadores atualmente conectados (exceto ele mesmo) para o novo jogador
            const otherPlayers = Object.values(connectedPlayers).filter(p => p.playerId !== playerId);
            socket.emit('currentPlayers', otherPlayers);
            console.log(`Enviando ${otherPlayers.length} jogadores existentes para o novo jogador.`);

            // Avisa a todos os outros jogadores que um novo jogador conectou
            socket.broadcast.emit('playerConnected', {
                playerId: playerProfile.id,
                username: playerProfile.username,
                x_pos: playerProfile.x_pos,
                y_pos: playerProfile.y_pos,
                life: playerProfile.life,
                life_max: playerProfile.life_max
            });
            console.log(`Notificando outros clientes sobre novo jogador: ${playerProfile.username}`);
        } else {
            console.error(`playerLoggedIn: Perfil para ID ${playerId} não encontrado após login.`);
        }
    });

    // Evento para solicitar inventário após login (mantido, mas playerLoggedIn já carrega)
    socket.on('requestPlayerInventory', async (playerId) => {
        if (connectedPlayers[socket.id] && connectedPlayers[socket.id].playerId === playerId) {
            const inventory = await loadPlayerInventory(playerId);
            connectedPlayers[socket.id].inventory = inventory; // Atualiza o estado interno do servidor
            socket.emit('playerInventoryUpdate', inventory);
        } else {
            console.warn(`Tentativa de solicitar inventário para ID inválido: ${playerId} do socket ${socket.id}`);
        }
    });

    // NOVO: Evento para receber movimento do jogador
    socket.on('playerMovement', async (data) => {
        const player = connectedPlayers[socket.id];
        if (player && player.playerId === data.playerId) { // Confirma que o socket é do jogador
            const { x, y } = data;

            // Limita o movimento dentro dos limites do mapa (assumindo 10x10 como no client)
            player.x_pos = Math.max(0, Math.min(9, x)); // MAP_WIDTH - 1
            player.y_pos = Math.max(0, Math.min(9, y)); // MAP_HEIGHT - 1

            // TODO: Salvar a posição no banco de dados (ainda opcional para testes)
            // if (needsUpdateInDb) {
            //     const { error } = await supabase.from('players').update({ x_pos: player.x_pos, y_pos: player.y_pos }).eq('id', player.playerId);
            //     if (error) console.error('Erro ao salvar posição:', error.message);
            // }

            // Transmitir a nova posição para outros jogadores (multiplayer)
            socket.broadcast.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos });
        } else {
            console.warn(`Movimento inválido para ID: ${data.playerId} do socket ${socket.id}`);
        }
    });

    // NOVO: Evento para equipar item
    socket.on('equipItem', (itemSlotIndex) => {
        const player = connectedPlayers[socket.id];
        if (player && player.inventory) {
            const itemToEquip = player.inventory[itemSlotIndex];
            if (itemToEquip && globalItemDefinitions[itemToEquip.item_id]) {
                player.equippedItem = itemToEquip.item_id;
                console.log(`${player.username} equipou: ${globalItemDefinitions[itemToEquip.item_id].name}`);
                // Notificar o próprio cliente e outros sobre o item equipado
                socket.emit('equippedItemUpdate', player.equippedItem);
                socket.broadcast.emit('playerEquippedItem', { playerId: player.playerId, equippedItemId: player.equippedItem });
            } else {
                player.equippedItem = null; // Desequipar se o slot estiver vazio
                socket.emit('equippedItemUpdate', player.equippedItem);
                socket.broadcast.emit('playerEquippedItem', { playerId: player.playerId, equippedItemId: player.equippedItem });
                console.log(`${player.username} desequipou.`);
            }
        }
    });

    // NOVO: Lógica de Combate
    socket.on('playerAttack', async (targetPlayerId) => {
        const attacker = connectedPlayers[socket.id];
        const targetSocketId = Object.keys(connectedPlayers).find(sId => connectedPlayers[sId].playerId === targetPlayerId);
        const target = connectedPlayers[targetSocketId];

        if (!attacker || !target) {
            socket.emit('mensagemDoServidor', 'Erro: Atacante ou alvo inválido.');
            return;
        }
        if (attacker.playerId === target.playerId) {
            socket.emit('mensagemDoServidor', 'Você não pode se atacar!');
            return;
        }

        const equippedWeaponId = attacker.equippedItem;
        const equippedWeaponDef = equippedWeaponId ? globalItemDefinitions[equippedWeaponId] : null;
        const weaponStats = equippedWeaponDef && equippedWeaponDef.type === 'weapon' ? globalWeaponStats[equippedWeaponDef.name] : null;

        if (!weaponStats) {
            socket.emit('mensagemDoServidor', 'Você não tem uma arma equipada válida para atacar!');
            return;
        }

        // Lógica de alcance (simplificada para teste, assumindo proximidade visual)
        const distance = Math.sqrt(
            Math.pow(attacker.x_pos - target.x_pos, 2) +
            Math.pow(attacker.y_pos - target.y_pos, 2)
        );

        if (distance > weaponStats.range) {
            socket.emit('mensagemDoServidor', `O alvo está muito longe. Alcance da arma: ${weaponStats.range}. Distância atual: ${distance.toFixed(1)}`);
            return;
        }

        // Calcular dano
        const damage = weaponStats.base_damage;

        target.life -= damage;
        console.log(`${attacker.username} atacou ${target.username} com ${equippedWeaponDef.name}. ${target.username} perdeu ${damage} de vida. Vida restante: ${target.life}`);

        // Notificar clientes sobre a atualização de vida
        io.to(target.socketId).emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max });
        socket.emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max }); // Para o atacante ver a vida do alvo
        socket.broadcast.emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max });


        if (target.life <= 0) {
            console.log(`${target.username} morreu!`);
            io.emit('playerDied', { playerId: target.playerId, killerId: attacker.playerId });

            // Lógica de drop de itens
            const { error: deleteError } = await supabase.from('player_inventory').delete().eq('player_id', target.playerId);
            if (deleteError) {
                console.error('Erro ao deletar inventário do jogador morto:', deleteError.message);
            }
            // TODO: Transferir para o inventário do assassino ou dropar no mapa
            // Por enquanto, apenas esvazia o inventário do morto.

            // Resetar o jogador morto (spawn)
            target.life = target.life_max;
            target.x_pos = Math.floor(Math.random() * 10); // Spawn aleatório
            target.y_pos = Math.floor(Math.random() * 10);
            io.to(target.socketId).emit('playerRespawn', { x: target.x_pos, y: target.y_pos });
            socket.broadcast.emit('playerMoved', { playerId: target.playerId, x: target.x_pos, y: target.y_pos }); // Avisa a todos da nova posição

            // Atualizar vida do jogador morto para ele mesmo
            io.to(target.socketId).emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max });

            // Se o target for o jogador que você está controlando, precisa ser atualizado localmente também
            if (targetSocketId === socket.id) {
                // Você morre, precisa de um feedback visual no cliente.
            }
        }
    });

    // Chat: Apenas mensagens de jogadores, comandos específicos do servidor
    socket.on('chatMessage', async (message) => { // Renomeado de 'mensagemDoCliente' para clareza
        const player = connectedPlayers[socket.id];
        if (!player) {
            socket.emit('serverMessage', 'Erro: Você não está logado para enviar mensagens.');
            return;
        }
        if (message.startsWith('/')) {
            // Se for um comando, trate como comando
            socket.emit('serverMessage', 'Comandos devem ser enviados via evento "chatCommand".');
        } else {
            // Mensagem normal do chat
            const username = player.username;
            io.emit('chatMessage', { sender: username, text: message }); // Envia para TODOS, incluindo o remetente
            console.log(`[Chat] ${username}: ${message}`);
        }
    });

    socket.on('chatCommand', async (command) => {
        const playerId = connectedPlayers[socket.id]?.playerId;
        const playerUsername = connectedPlayers[socket.id]?.username;

        if (!playerId) {
            socket.emit('serverMessage', 'Erro: Você não está logado para usar comandos.');
            return;
        }

        if (command.startsWith('/additem ')) {
            const parts = command.split(' ');
            const itemName = parts.slice(1).join(' ').toLowerCase();

            const itemToAdd = Object.values(globalItemDefinitions).find(item => item.name.toLowerCase() === itemName);

            if (!itemToAdd) {
                socket.emit('serverMessage', `Erro: Item '${itemName}' não encontrado.`);
                return;
            }

            try {
                const { data: existingInventoryItems, error: findError } = await supabase
                    .from('player_inventory')
                    .select('*')
                    .eq('player_id', playerId)
                    .eq('item_id', itemToAdd.id);

                if (findError) {
                    throw findError;
                }

                let message = '';
                let inventoryUpdated = false;

                let existingItemSlot = null;
                // Verificar se o item é empilhável e se há um slot existente com espaço
                if (itemToAdd.max_stack > 1) {
                    existingItemSlot = existingInventoryItems.find(invItem => invItem.quantity < itemToAdd.max_stack);
                }

                if (existingItemSlot) {
                    const newQuantity = Math.min(existingItemSlot.quantity + 1, itemToAdd.max_stack || Infinity); // Garante que não exceda max_stack
                    const { error: updateError } = await supabase
                        .from('player_inventory')
                        .update({ quantity: newQuantity })
                        .eq('id', existingItemSlot.id);
                    if (updateError) throw updateError;
                    message = `Você adicionou 1 ${itemToAdd.name}. Quantidade: ${newQuantity}`;
                    inventoryUpdated = true;
                } else {
                    const { error: insertError } = await supabase
                        .from('player_inventory')
                        .insert([{ player_id: playerId, item_id: itemToAdd.id, quantity: 1 }]);
                    if (insertError) throw insertError;
                    message = `Você adicionou 1 ${itemToAdd.name}${existingInventoryItems.length > 0 ? ' (novo slot)' : ''}.`;
                    inventoryUpdated = true;
                }

                socket.emit('serverMessage', message); // Mensagem do servidor para o comando

                if (inventoryUpdated) {
                    const updatedInventory = await loadPlayerInventory(playerId);
                    connectedPlayers[socket.id].inventory = updatedInventory; // Atualiza o estado no servidor
                    socket.emit('playerInventoryUpdate', updatedInventory); // Envia para o cliente
                }

            } catch (error) {
                console.error('Erro ao adicionar item ao inventário:', error.message);
                socket.emit('serverMessage', `Erro interno ao adicionar item: ${error.message}`);
            }
        } else if (command.startsWith('/spawn ')) { // Exemplo de comando /spawn
            const parts = command.split(' ');
            const targetX = parseInt(parts[1]);
            const targetY = parseInt(parts[2]);

            if (isNaN(targetX) || isNaN(targetY)) {
                socket.emit('serverMessage', 'Uso: /spawn <x> <y>');
                return;
            }

            const player = connectedPlayers[socket.id];
            if (player) {
                player.x_pos = Math.max(0, Math.min(9, targetX));
                player.y_pos = Math.max(0, Math.min(9, targetY));
                // Atualizar no DB
                const { error } = await supabase.from('players').update({ x_pos: player.x_pos, y_pos: player.y_pos }).eq('id', player.playerId);
                if (error) console.error('Erro ao salvar posição:', error.message);

                socket.emit('serverMessage', `Você foi teleportado para X:${player.x_pos}, Y:${player.y_pos}`);
                socket.emit('playerRespawn', { x: player.x_pos, y: player.y_pos }); // Para o próprio cliente
                socket.broadcast.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos }); // Para os outros
            } else {
                socket.emit('serverMessage', 'Erro: Player não encontrado no estado do servidor.');
            }
        }
        else {
            socket.emit('serverMessage', 'Comando desconhecido: ' + command);
        }
    });

    socket.on('disconnect', () => {
        console.log('Um jogador desconectou:', socket.id);
        const player = connectedPlayers[socket.id];
        if (player) {
            console.log(`Removendo Player ID ${player.playerId} (${player.username}) do socket ${socket.id}.`);
            delete connectedPlayers[socket.id];
            // Notificar outros clientes que este jogador desconectou
            io.emit('playerDisconnected', player.playerId);
        }
    });
});


server.listen(PORT, () => {
    console.log(`Servidor Low Campfire rodando na porta ${PORT}`);
});

