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
        // CORREÇÃO: Caminho do weapon_stats.json
        const weaponStatsPath = path.join(__dirname, '../client/data/weapon_stats.json'); // Ajustado para client/data
        const data = await fs.readFile(weaponStatsPath, 'utf8');
        globalWeaponStats = JSON.parse(data);
        console.log('Definições de estatísticas de armas carregadas do arquivo.'); // Removido o log completo para não poluir
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

// Mapa de jogadores conectados: { socket.id: { playerId: uuid, username: string, x: number, y: number, life: number, life_max: number, inventory: [], equippedItem: id, lastAttackTime: timestamp } }
const connectedPlayers = {};
const ATTACK_COOLDOWN = 1000; // 1 segundo de cooldown para ataques

app.use(express.json());

// Função para inserir um novo perfil de jogador na tabela 'players'
async function insertPlayerProfile(userId, username, email) {
    try {
        // CORREÇÃO: Não inserir inventory e equippedItem aqui, eles são carregados separadamente.
        // E garantir que 'id' é o userId para RLS.
        const { data, error } = await supabase
            .from('players')
            .insert([
                { id: userId, username: username, email: email, x_pos: 0, y_pos: 0, money: 0, life: 10, life_max: 10, inventory: [], equipped_item_id: null } // Adicionado life e life_max, e campos para inventário
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
            .select('item_id, quantity') // Seleciona apenas o ID do item e a quantidade
            .eq('player_id', playerId);

        if (error) {
            console.error('Erro ao carregar inventário do jogador:', error.message);
            return [];
        }
        // console.log(`Inventário carregado para ${playerId}:`, data); // Para debug
        return data;
    } catch (err) {
        console.error('Erro inesperado ao carregar inventário:', err.message);
        return [];
    }
}

// Função para salvar o inventário de um jogador
async function savePlayerInventory(playerId, inventory) {
    try {
        // Primeiro, delete todas as entradas existentes para o jogador
        const { error: deleteError } = await supabase
            .from('player_inventory')
            .delete()
            .eq('player_id', playerId);

        if (deleteError) {
            console.error('Erro ao limpar inventário existente:', deleteError.message);
            return false;
        }

        // Prepare os dados para inserção
        const itemsToInsert = inventory.map(item => ({
            player_id: playerId,
            item_id: item.item_id,
            quantity: item.quantity
        }));

        // Insira os novos itens
        if (itemsToInsert.length > 0) {
            const { error: insertError } = await supabase
                .from('player_inventory')
                .insert(itemsToInsert);

            if (insertError) {
                console.error('Erro ao salvar inventário:', insertError.message);
                return false;
            }
        }
        return true;
    } catch (err) {
        console.error('Erro inesperado ao salvar inventário:', err.message);
        return false;
    }
}


// --- Rotas de Autenticação ---
app.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Email, senha e nome de usuário são obrigatórios.' });
    }

    try {
        // CORREÇÃO: Verificar se o username já existe ANTES de tentar o signup no Auth
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

        // CORREÇÃO: Tenta criar o perfil do jogador IMEDIATAMENTE após o registro no Auth
        const playerProfile = await insertPlayerProfile(user.id, username, email);

        if (!playerProfile) {
            console.error('Falha ao criar perfil do jogador após registro Auth. Tentando reverter registro Auth.');
            // CORREÇÃO: Se falhar ao criar o perfil do jogador, deletar o usuário Auth para evitar lixo
            const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
            if (deleteUserError) {
                console.error('Erro ao deletar usuário Auth após falha na criação do player:', deleteUserError.message);
            } else {
                console.log(`Usuário Auth ${user.id} deletado com sucesso após falha na criação do player.`);
            }
            return res.status(500).json({ error: 'Registro bem-sucedido no Auth, mas falha ao criar perfil do jogador. Verifique RLS e restrições de tabela.' });
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

        let playerProfile = await loadPlayerProfile(user.id);

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

// Servir assets da pasta 'assets' (já estava certo)
app.use('/assets', express.static(path.join(__dirname, '../client/assets')));


// Lógica do Socket.io
io.on('connection', async (socket) => {
    console.log('Um jogador conectou:', socket.id);

    // Envia definições de itens e armas imediatamente para o cliente
    socket.emit('globalItemDefinitions', globalItemDefinitions);
    socket.emit('globalWeaponStats', globalWeaponStats);
    console.log('Definições de itens e armas enviadas para o novo cliente.');

    socket.on('playerLoggedIn', async (playerId) => {
        if (!playerId) {
            console.warn(`playerLoggedIn: Player ID é nulo para socket ${socket.id}`);
            return;
        }

        const playerProfile = await loadPlayerProfile(playerId);
        if (playerProfile) {
            const inventory = await loadPlayerInventory(playerId); // Carrega inventário
            // CORREÇÃO: Inicializa o jogador com dados completos, incluindo inventário e item equipado
            connectedPlayers[socket.id] = {
                socketId: socket.id,
                playerId: playerId,
                username: playerProfile.username,
                x_pos: playerProfile.x_pos,
                y_pos: playerProfile.y_pos,
                life: playerProfile.life,
                life_max: playerProfile.life_max,
                inventory: inventory,
                equippedItem: playerProfile.equipped_item_id, // Usar o campo do banco
                lastAttackTime: 0 // Para cooldown de ataque
            };
            console.log(`Socket ${socket.id} associado ao Player ID: ${playerId} (${playerProfile.username})`);

            // Envia o estado atual do jogador recém-logado para ele mesmo
            socket.emit('playerStateUpdate', connectedPlayers[socket.id]);
            socket.emit('playerInventoryUpdate', inventory); // Garante que o inventário é enviado

            // Envia todos os jogadores atualmente conectados (exceto ele mesmo) para o novo jogador
            const otherPlayers = Object.values(connectedPlayers)
                .filter(p => p.playerId !== playerId)
                .map(p => ({
                    playerId: p.playerId,
                    username: p.username,
                    x_pos: p.x_pos,
                    y_pos: p.y_pos,
                    life: p.life,
                    life_max: p.life_max,
                    equippedItem: p.equippedItem // Envia o item equipado para outros clientes
                }));
            socket.emit('currentPlayers', otherPlayers);
            console.log(`Enviando ${otherPlayers.length} jogadores existentes para o novo jogador.`);

            // Avisa a todos os outros jogadores que um novo jogador conectou
            socket.broadcast.emit('playerConnected', {
                playerId: playerProfile.id,
                username: playerProfile.username,
                x_pos: playerProfile.x_pos,
                y_pos: playerProfile.y_pos,
                life: playerProfile.life,
                life_max: playerProfile.life_max,
                equippedItem: playerProfile.equipped_item_id // Envia o item equipado
            });
            console.log(`Notificando outros clientes sobre novo jogador: ${playerProfile.username}`);
        } else {
            console.error(`playerLoggedIn: Perfil para ID ${playerId} não encontrado após login.`);
        }
    });

    // Evento para receber movimento do jogador
    socket.on('playerMovement', async (data) => {
        const player = connectedPlayers[socket.id];
        if (player) { // Não precisa mais checar playerId === data.playerId aqui, já está associado
            const { x, y } = data;

            player.x_pos = Math.max(0, Math.min(9, x));
            player.y_pos = Math.max(0, Math.min(9, y));

            // CORREÇÃO: Salvar a posição no banco de dados para persistência
            // Pode ser feito com um debounce ou em intervalos regulares para evitar spam de writes no DB
            const { error } = await supabase.from('players').update({ x_pos: player.x_pos, y_pos: player.y_pos }).eq('id', player.playerId);
            if (error) console.error('Erro ao salvar posição:', error.message);

            // Transmitir a nova posição para outros jogadores (multiplayer)
            socket.broadcast.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos });
        } else {
            console.warn(`Movimento inválido: Jogador não encontrado para socket ${socket.id}`);
        }
    });

    // Evento para equipar item
    socket.on('equipItem', async (itemSlotIndex) => { // Adicionado async
        const player = connectedPlayers[socket.id];
        if (player && player.inventory) {
            const itemToEquip = player.inventory[itemSlotIndex];
            if (itemToEquip && globalItemDefinitions[itemToEquip.item_id]) {
                player.equippedItem = itemToEquip.item_id;
                console.log(`${player.username} equipou: ${globalItemDefinitions[itemToEquip.item_id].name}`);

                // CORREÇÃO: Salvar item equipado no banco de dados
                const { error } = await supabase.from('players').update({ equipped_item_id: player.equippedItem }).eq('id', player.playerId);
                if (error) console.error('Erro ao salvar item equipado:', error.message);

                socket.emit('equippedItemUpdate', player.equippedItem);
                socket.broadcast.emit('playerEquippedItem', { playerId: player.playerId, equippedItemId: player.equippedItem });
            } else {
                player.equippedItem = null; // Desequipar se o slot estiver vazio
                const { error } = await supabase.from('players').update({ equipped_item_id: null }).eq('id', player.playerId);
                if (error) console.error('Erro ao desequipar item:', error.message);

                socket.emit('equippedItemUpdate', player.equippedItem);
                socket.broadcast.emit('playerEquippedItem', { playerId: player.playerId, equippedItemId: player.equippedItem });
                console.log(`${player.username} desequipou.`);
            }
        }
    });

    // Lógica de Combate
    socket.on('playerAttack', async (targetPlayerId) => {
        const attacker = connectedPlayers[socket.id];
        // CORREÇÃO: Encontrar o socket do alvo dinamicamente
        const targetSocketId = Object.keys(connectedPlayers).find(sId => connectedPlayers[sId].playerId === targetPlayerId);
        const target = connectedPlayers[targetSocketId];

        if (!attacker) {
            socket.emit('serverMessage', 'Erro: Você não está logado para atacar.');
            return;
        }

        if (attacker.lastAttackTime && (Date.now() - attacker.lastAttackTime < ATTACK_COOLDOWN)) {
            socket.emit('serverMessage', 'Ataque em cooldown. Espere um pouco.');
            return;
        }

        if (!target) {
            socket.emit('serverMessage', 'Erro: Alvo inválido ou não encontrado.');
            return;
        }
        if (attacker.playerId === target.playerId) {
            socket.emit('serverMessage', 'Você não pode se atacar!');
            return;
        }

        const equippedWeaponId = attacker.equippedItem;
        const equippedWeaponDef = equippedWeaponId ? globalItemDefinitions[equippedWeaponId] : null;
        // CORREÇÃO: Acessar globalWeaponStats pelo nome do item, não pelo ID do item.
        const weaponStats = equippedWeaponDef && equippedWeaponDef.type === 'weapon' ? globalWeaponStats[equippedWeaponDef.name] : null;


        if (!weaponStats) {
            socket.emit('serverMessage', 'Você não tem uma arma equipada válida para atacar!');
            return;
        }

        // Lógica de alcance
        const distance = Math.sqrt(
            Math.pow(attacker.x_pos - target.x_pos, 2) +
            Math.pow(attacker.y_pos - target.y_pos, 2)
        );

        if (distance > weaponStats.range) {
            socket.emit('serverMessage', `O alvo está muito longe. Alcance da arma: ${weaponStats.range}. Distância atual: ${distance.toFixed(1)}`);
            return;
        }

        // Calcular dano
        const damage = weaponStats.base_damage;

        target.life -= damage;
        console.log(`${attacker.username} atacou ${target.username} com ${equippedWeaponDef.name}. ${target.username} perdeu ${damage} de vida. Vida restante: ${target.life}`);

        // Atualiza o tempo do último ataque para o cooldown
        attacker.lastAttackTime = Date.now();

        // Notificar clientes sobre a atualização de vida
        io.to(target.socketId).emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max });
        // Emitir também para o atacante ver a vida do alvo
        socket.emit('playerHealthUpdate', { playerId: target.playerId, life: target.playerId, life: target.life, life_max: target.life_max });
        // Notificar todos os outros (exceto atacante e alvo se já notificados)
        socket.broadcast.emit('playerHealthUpdate', { playerId: target.playerId, life: target.life, life_max: target.life_max });

        // CORREÇÃO: Salvar vida do alvo no banco de dados
        const { error: updateLifeError } = await supabase.from('players').update({ life: target.life }).eq('id', target.playerId);
        if (updateLifeError) console.error('Erro ao salvar vida do alvo:', updateLifeError.message);


        if (target.life <= 0) {
            console.log(`${target.username} morreu!`);
            io.emit('playerDied', { playerId: target.playerId, killerId: attacker.playerId });

            // Lógica de drop de itens (agora salvando)
            const wasInventorySaved = await savePlayerInventory(target.playerId, []); // Esvazia o inventário
            if (!wasInventorySaved) {
                console.error('Erro ao esvaziar inventário do jogador morto.');
            } else {
                console.log(`Inventário de ${target.username} esvaziado.`);
            }

            // Resetar o jogador morto (spawn)
            target.life = target.life_max;
            target.x_pos = Math.floor(Math.random() * 10); // Spawn aleatório
            target.y_pos = Math.floor(Math.random() * 10);

            // CORREÇÃO: Salvar nova posição e vida no banco de dados
            const { error: respawnSaveError } = await supabase
                .from('players')
                .update({ x_pos: target.x_pos, y_pos: target.y_pos, life: target.life })
                .eq('id', target.playerId);
            if (respawnSaveError) console.error('Erro ao salvar respawn do jogador:', respawnSaveError.message);


            io.to(target.socketId).emit('playerRespawn', { x: target.x_pos, y: target.y_pos, life: target.life, life_max: target.life_max }); // Para o próprio cliente
            socket.broadcast.emit('playerMoved', { playerId: target.playerId, x: target.x_pos, y: target.y_pos }); // Avisa a todos da nova posição
            io.to(target.socketId).emit('playerInventoryUpdate', []); // Avisa o jogador que o inventário foi esvaziado.
            console.log(`${target.username} reapareceu em (${target.x_pos}, ${target.y_pos}) com vida cheia.`);
        }
    });

    // Chat e Comandos
    socket.on('chatMessage', async (message) => {
        const player = connectedPlayers[socket.id];
        if (!player) {
            socket.emit('serverMessage', 'Erro: Você não está logado para enviar mensagens.');
            return;
        }
        // CORREÇÃO: Comando /additem e /spawn devem ser tratados via chatCommand (já está).
        // Se a mensagem começar com '/', enviar para chatCommand.
        if (message.startsWith('/')) {
            socket.emit('serverMessage', 'Comandos devem ser enviados via evento "chatCommand".');
            return;
        }
        // Mensagem normal do chat
        const username = player.username;
        io.emit('chatMessage', { sender: username, text: message });
        console.log(`[Chat] ${username}: ${message}`);
    });

    socket.on('chatCommand', async (command) => {
        const player = connectedPlayers[socket.id];
        if (!player) {
            socket.emit('serverMessage', 'Erro: Você não está logado para usar comandos.');
            return;
        }

        const playerId = player.playerId;
        const playerUsername = player.username;

        if (command.startsWith('/additem ')) {
            const parts = command.split(' ');
            const itemName = parts.slice(1).join(' ').toLowerCase();

            const itemToAdd = Object.values(globalItemDefinitions).find(item => item.name.toLowerCase() === itemName);

            if (!itemToAdd) {
                socket.emit('serverMessage', `Erro: Item '${itemName}' não encontrado.`);
                return;
            }

            try {
                let inventoryUpdated = false;
                let message = '';

                // Encontra o item no inventário do jogador (estado do servidor)
                let existingItemInInventory = player.inventory.find(invItem => invItem.item_id === itemToAdd.id);

                if (existingItemInInventory && itemToAdd.max_stack > 1 && existingItemInInventory.quantity < itemToAdd.max_stack) {
                    // Item empilhável e há espaço
                    existingItemInInventory.quantity += 1;
                    message = `Você adicionou 1 ${itemToAdd.name}. Quantidade: ${existingItemInInventory.quantity}`;
                    inventoryUpdated = true;
                } else if (!existingItemInInventory || itemToAdd.max_stack === 1) {
                    // Item não empilhável ou slot cheio, adiciona novo slot
                    player.inventory.push({ item_id: itemToAdd.id, quantity: 1 });
                    message = `Você adicionou 1 ${itemToAdd.name} (novo slot).`;
                    inventoryUpdated = true;
                } else {
                    // Caso de item empilhável mas sem espaço para empilhar
                    socket.emit('serverMessage', `Seu inventário para ${itemToAdd.name} está cheio. Max stack: ${itemToAdd.max_stack}.`);
                    return;
                }

                if (inventoryUpdated) {
                    const wasSaved = await savePlayerInventory(playerId, player.inventory);
                    if (wasSaved) {
                        socket.emit('serverMessage', message);
                        socket.emit('playerInventoryUpdate', player.inventory); // Envia para o cliente
                        console.log(`${playerUsername} adicionou ${itemToAdd.name}. Inventário atualizado.`);
                    } else {
                        socket.emit('serverMessage', `Erro ao salvar inventário após adicionar ${itemToAdd.name}.`);
                    }
                }

            } catch (error) {
                console.error('Erro ao adicionar item ao inventário:', error.message);
                socket.emit('serverMessage', `Erro interno ao adicionar item: ${error.message}`);
            }
        } else if (command.startsWith('/spawn ')) {
            const parts = command.split(' ');
            const targetX = parseInt(parts[1]);
            const targetY = parseInt(parts[2]);

            if (isNaN(targetX) || isNaN(targetY)) {
                socket.emit('serverMessage', 'Uso: /spawn <x> <y>');
                return;
            }

            player.x_pos = Math.max(0, Math.min(9, targetX));
            player.y_pos = Math.max(0, Math.min(9, targetY));

            // Atualizar no DB
            const { error } = await supabase.from('players').update({ x_pos: player.x_pos, y_pos: player.y_pos }).eq('id', player.playerId);
            if (error) console.error('Erro ao salvar posição:', error.message);

            socket.emit('serverMessage', `Você foi teleportado para X:${player.x_pos}, Y:${player.y_pos}`);
            socket.emit('playerRespawn', { x: player.x_pos, y: player.y_pos });
            socket.broadcast.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos });
        } else {
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
