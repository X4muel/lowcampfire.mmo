// server/server.js

require('dotenv').config();

// Mantenha essa linha aqui, mas certifique-se de que '@supabase/supabase-js' está instalado
const { createClient } = require('@supabase/supabase-js');

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

let globalItemDefinitions = {};

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
                acc[item.id] = item;
                return acc;
            }, {});
        }
    } catch (err) {
        console.error('Erro inesperado ao carregar definições de itens:', err.message);
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
            console.log('Conectado ao Supabase com sucesso (players)! Exemplo:', data);
        }
    } catch (err) {
        console.error('Erro inesperado ao conectar ao Supabase:', err.message);
    }

    await loadGlobalItemDefinitions();
}

testSupabaseConnection();

const connectedPlayers = {}; // { socket.id: player_id (uuid) }

app.use(express.json());

// Função para inserir um novo perfil de jogador na tabela 'players'
async function insertPlayerProfile(userId, username, email) {
    try {
        const { data, error } = await supabase
            .from('players')
            .insert([
                { id: userId, username: username, email: email, x_pos: 0, y_pos: 0, money: 0 }
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
        // Usar .limit(1) para garantir que você pegue apenas um, mesmo se por algum motivo tiver múltiplos
        const { data: playerProfiles, error } = await supabase
            .from('players')
            .select('*')
            .eq('id', playerId)
            .limit(1); // Importante: Garante que mesmo se houver múltiplos, pegue apenas um

        if (error) {
            console.error('Erro Supabase ao carregar perfil do jogador:', error.message);
            return null;
        }
        // Se `data` for um array e estiver vazio, `playerProfile` será `undefined`
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

// NOVO: Função para carregar o inventário de um jogador
async function loadPlayerInventory(playerId) {
    try {
        const { data, error } = await supabase
            .from('player_inventory')
            .select('*') // Seleciona tudo para ter item_id e quantity
            .eq('player_id', playerId);

        if (error) {
            console.error('Erro ao carregar inventário do jogador:', error.message);
            return [];
        }
        console.log(`Inventário para o jogador ${playerId} carregado:`, data);
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
                    username: username
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

        // Tente carregar o perfil do jogador. Se existir, não crie.
        // Isso é uma redundância caso o usuário já tenha um perfil no 'players' mas o Auth.signUp tenha funcionado.
        let playerProfile = await loadPlayerProfile(user.id);
        if (!playerProfile) {
            playerProfile = await insertPlayerProfile(user.id, username, email);
        } else {
            console.log('Perfil do jogador já existe, não recriando.');
        }


        if (!playerProfile) {
            console.error('Falha ao criar perfil do jogador após registro Auth. Tentando reverter registro Auth.');
            // A Supabase Auth admin.deleteUser requer uma Service Role Key com permissões elevadas.
            // Para desenvolvimento, pode ser útil. Em produção, você controlaria isso de forma diferente.
            try {
                // Não é o auth.admin.deleteUser, mas sim um método mais direto.
                // Mas, se a RLS impede a criação, a remoção pode ser complexa.
                // Por agora, vamos apenas logar o erro e não tentar deletar o Auth user automaticamente,
                // já que a RLS é o bloqueio principal.
                // Se a RLS estiver correta, este bloco quase nunca será atingido.
                // A Supabase Auth não tem um rollback automático direto para o signUp
                // então lidamos com o perfil no 'players' como o ponto crítico.
            } catch (deleteErr) {
                console.error('Erro catastrófico ao tentar reverter o registro Auth (não implementado diretamente):', deleteErr.message);
            }
            return res.status(500).json({ error: 'Registro bem-sucedido no Auth, mas falha ao criar perfil do jogador. Verifique RLS.' });
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
            // Usar user.user_metadata.username se disponível, senão fallback para email
            const username = user.user_metadata ? user.user_metadata.username : user.email.split('@')[0];
            const newProfile = await insertPlayerProfile(user.id, username, user.email);
            if (newProfile) {
                console.log('Perfil do jogador criado on-the-fly após login.');
                return res.status(200).json({ message: 'Login bem-sucedido. Perfil do jogador criado.', user: user, player: newProfile });
            } else {
                return res.status(500).json({ error: 'Erro ao carregar/criar perfil do jogador. Verifique RLS para tabela players.' });
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

    // Envia definições de itens imediatamente para o cliente
    socket.emit('globalItemDefinitions', globalItemDefinitions);
    console.log('Definições de itens enviadas para o novo cliente.');

    socket.on('playerLoggedIn', (playerId) => {
        connectedPlayers[socket.id] = playerId;
        console.log(`Socket ${socket.id} associado ao Player ID: ${playerId}`);
    });

    // NOVO: Evento para solicitar inventário após login
    socket.on('requestPlayerInventory', async (playerId) => {
        // Verifica se o playerId recebido corresponde ao playerId associado a este socket
        // Isso é uma medida de segurança para evitar que um cliente peça o inventário de outro jogador
        if (connectedPlayers[socket.id] === playerId) {
            const inventory = await loadPlayerInventory(playerId);
            socket.emit('playerInventoryUpdate', inventory); // Envia o inventário para o cliente
        } else {
            console.warn(`Tentativa de solicitar inventário para ID inválido: ${playerId} do socket ${socket.id}`);
        }
    });

    // NOVO: Evento para receber movimento do jogador
    socket.on('playerMovement', async (data) => {
        const playerId = data.playerId;
        const { x, y } = data;

        if (connectedPlayers[socket.id] === playerId) {
            console.log(`Jogador ${playerId} moveu para X:${x}, Y:${y}`);
            // TODO: Salvar a posição no banco de dados, se desejar persistir
            // Você pode querer salvar isso no banco de dados para persistência,
            // mas para um movimento rápido, talvez não seja necessário a cada passo.
            // const { error } = await supabase
            //     .from('players')
            //     .update({ x_pos: x, y_pos: y })
            //     .eq('id', playerId);
            // if (error) {
            //     console.error('Erro ao salvar posição do jogador:', error.message);
            // }
            // TODO: Transmitir a posição para outros jogadores (multiplayer)
            // Isso será importante para o multiplayer:
            // socket.broadcast.emit('playerMoved', { playerId, x, y });
        } else {
            console.warn(`Movimento inválido para ID: ${playerId} do socket ${socket.id}`);
        }
    });


    socket.on('chatCommand', async (command) => {
        const playerId = connectedPlayers[socket.id];
        if (!playerId) {
            socket.emit('mensagemDoServidor', 'Erro: Você não está logado para usar comandos.');
            return;
        }

        if (command.startsWith('/additem ')) {
            const parts = command.split(' ');
            const itemName = parts.slice(1).join(' ').toLowerCase();

            const itemToAdd = Object.values(globalItemDefinitions).find(item => item.name.toLowerCase() === itemName);

            if (!itemToAdd) {
                socket.emit('mensagemDoServidor', `Erro: Item '${itemName}' não encontrado.`);
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
                if (itemToAdd.max_stack > 1) {
                    existingItemSlot = existingInventoryItems.find(invItem => invItem.quantity < itemToAdd.max_stack);
                }


                if (existingItemSlot) {
                    const newQuantity = Math.min(existingItemSlot.quantity + 1, itemToAdd.max_stack);
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

                socket.emit('mensagemDoServidor', message);

                if (inventoryUpdated) {
                    const updatedInventory = await loadPlayerInventory(playerId);
                    socket.emit('playerInventoryUpdate', updatedInventory);
                }

            } catch (error) {
                console.error('Erro ao adicionar item ao inventário:', error.message);
                socket.emit('mensagemDoServidor', `Erro interno ao adicionar item: ${error.message}`);
            }
        } else {
            socket.emit('mensagemDoServidor', 'Comando desconhecido: ' + command);
        }
    });

    socket.on('mensagemDoCliente', async (data) => {
        console.log('Mensagem do cliente:', data);
        io.emit('mensagemDoServidor', `[${socket.id.substring(0, 4)}]: ${data}`);
    });

    socket.on('disconnect', () => {
        console.log('Um jogador desconectou:', socket.id);
        if (connectedPlayers[socket.id]) {
            console.log(`Removendo Player ID ${connectedPlayers[socket.id]} do socket ${socket.id}.`);
            delete connectedPlayers[socket.id];
        }
    });
});


server.listen(PORT, () => {
    console.log(`Servidor Low Campfire rodando na porta ${PORT}`);
});
