// src/App.tsx

import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import { db } from './firebase';
import {
    doc, setDoc, updateDoc, onSnapshot, arrayUnion, deleteField,
    runTransaction, collection, getDocs, increment, getDoc, deleteDoc,
    writeBatch
} from "firebase/firestore";
import type { DocumentData, Transaction } from "firebase/firestore";
import Auth from './Auth';
import Leaderboard from './Leaderboard';
import Settings from './Settings';
import AlertPopup from './AlertPopup';
import { type User } from "firebase/auth";

// Value imports from gameLogic
import {
    generateRoomId, generateId, playerColors,
    initialBoardState, countryFlags,
    getInitialDynamicBoardState,
    handleBankruptcy,
    startAuction, goToJail, payJailFine,
    handleUsePardonCard, buyProperty, sellProperty, mortgageProperty,
    unmortgageProperty, buildHouse, sellHouse, handleLandingOnSquare
} from './gameLogic.tsx';

// Type imports from gameLogic
import type {
    PlayerId, RoomId, PropertyId, Player, GameState,
    Trade, Card, CitySquare, UtilitySquare, TaxSquare,
    BaseSquare
} from './gameLogic.tsx';

// ==========================================================
// WIDGET COMPONENTS
// ==========================================================

const ClockWidget: FC = () => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    return (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-lg flex flex-col items-center justify-center">
            <h3 className="text-lg font-semibold text-gray-400 mb-2">Current Time</h3>
            <div className="text-4xl font-mono font-bold text-cyan-400">
                {time.toLocaleTimeString()}
            </div>
        </div>
    );
};

const RulesWidget: FC = () => {
    return (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-400 mb-2">Quick Rules</h3>
            <ul className="list-disc list-inside text-sm space-y-1 text-gray-300">
                <li>Roll dice to move around the board.</li>
                <li>Buy properties to collect rent.</li>
                <li>Collect full country sets to build houses.</li>
                <li>Bankrupt your opponents to win!</li>
            </ul>
        </div>
    );
};

interface PlayerProfileProps {
    currentPlayerId: PlayerId;
}

const PlayerProfileWidget: FC<PlayerProfileProps> = ({ currentPlayerId }) => {
    return (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-lg flex items-center gap-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            <div>
                <h3 className="text-lg font-semibold text-gray-400">Player Profile</h3>
                <p className="text-sm text-gray-300 break-all">{currentPlayerId}</p>
            </div>
        </div>
    );
};

interface AdminSettingsWidgetProps {
    gameState: GameState;
    roomId: RoomId;
    currentPlayerId: PlayerId;
    showAlert: (message: string) => void;
}

const AdminSettingsWidget: FC<AdminSettingsWidgetProps> = ({ gameState, roomId, currentPlayerId, showAlert }) => {
    const { settings } = gameState;
    const isHost = gameState.hostId === currentPlayerId;

    const handleSettingChange = async (setting: keyof GameState['settings'], value: boolean | number) => {
        if (gameState.status !== 'waiting' || !isHost) {
            showAlert("Settings can only be changed by the host before the game starts.");
            return;
        }

        const updates: DocumentData = {
            [`settings.${setting}`]: value,
            gameLog: arrayUnion(`Admin changed ${setting} to ${value}.`)
        };

        if (setting === 'initialMoney') {
            Object.keys(gameState.players).forEach(playerId => {
                updates[`players.${playerId}.money`] = value;
            });
        }

        await updateDoc(doc(db, "games", roomId), updates);
    };

    const ToggleButton: FC<{label: string, settingKey: keyof GameState['settings'], currentValue: boolean}> = ({label, settingKey, currentValue}) => (
        <div className="flex justify-between items-center bg-gray-800 p-2 rounded">
            <label htmlFor={String(settingKey)} className="text-xs text-gray-300">{label}</label>
            <button
                id={String(settingKey)}
                onClick={() => handleSettingChange(settingKey, !currentValue)}
                disabled={!isHost || gameState.status !== 'waiting'}
                className={`px-2 py-0.5 text-xs font-bold rounded-full transition-colors ${currentValue ? 'bg-green-500 text-white' : 'bg-red-500 text-white'} disabled:bg-gray-500 disabled:cursor-not-allowed`}
            >
                {currentValue ? 'ON' : 'OFF'}
            </button>
        </div>
    );

    return (
        <div className="bg-gray-700 p-2 rounded mb-3">
            <h2 className="text-base font-semibold mb-2 text-center">Game Settings</h2>
            <div className="space-y-1">
                <div className="flex justify-between items-center bg-gray-800 p-2 rounded">
                    <label htmlFor="initialMoney" className="text-xs text-gray-300">Initial Money</label>
                    <select
                        id="initialMoney"
                        value={settings.initialMoney}
                        onChange={(e) => handleSettingChange('initialMoney', Number(e.target.value))}
                        disabled={!isHost || gameState.status !== 'waiting'}
                        className="p-1 bg-gray-700 border border-gray-500 rounded text-white text-xs disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                        <option value="500">$500</option>
                        <option value="1500">$1500</option>
                        <option value="2500">$2500</option>
                        <option value="3000">$3000</option>
                        <option value="5000">$5000</option>
                        <option value="10000">$10000</option>
                    </select>
                </div>
                <ToggleButton label="Unowned Prop. Auctions" settingKey="allowAuctions" currentValue={settings.allowAuctions} />
                <ToggleButton label="Owned Prop. Auctions" settingKey="allowOwnedPropertyAuctions" currentValue={settings.allowOwnedPropertyAuctions} />
                <ToggleButton label="Mortgaging" settingKey="allowMortgage" currentValue={settings.allowMortgage} />
                <ToggleButton label="Rent in Jail" settingKey="rentInJail" currentValue={settings.rentInJail} />
                <ToggleButton label="Tax to Vacation Pot" settingKey="taxInVacationPot" currentValue={settings.taxInVacationPot} />
                <ToggleButton label="2x Rent on Monopoly" settingKey="doubleRentOnMonopoly" currentValue={settings.doubleRentOnMonopoly} />
                <ToggleButton label="Increasing Jail Fine" settingKey="increasingJailFine" currentValue={settings.increasingJailFine} />
            </div>
        </div>
    );
};
// ==========================================================
// PAGE & MAJOR GAME COMPONENTS
// ==========================================================

interface LobbyProps {
    currentPlayerId: PlayerId;
    user: User | null;
    showAlert: (message: string) => void;
}

const Lobby: FC<LobbyProps> = ({ currentPlayerId, user, showAlert }) => {
    const [playerName, setPlayerName] = useState("");
    const [joinRoomId, setJoinRoomId] = useState("");
    const maxPlayers = 8;

    useEffect(() => {
        const fetchGameName = async () => {
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists() && userDoc.data().gameName) {
                    setPlayerName(userDoc.data().gameName);
                } else {
                    setPlayerName(user.displayName || "");
                }
            }
        };
        fetchGameName();
    }, [user]);

    const handleCreateGame = async () => {
        if (!playerName) return showAlert("Please enter your name.");
        
        let newRoomId: RoomId;
        let gameRef;
        let docSnap;
        const initialMoney = 1500; // Default value

        do {
            newRoomId = generateRoomId();
            gameRef = doc(db, "games", newRoomId);
            docSnap = await getDoc(gameRef);
        } while (docSnap.exists());

        const newGame: GameState = {
            gameId: newRoomId,
            hostId: currentPlayerId,
            status: "waiting",
            board: getInitialDynamicBoardState(),
            settings: { 
                initialMoney: initialMoney, 
                maxPlayers: maxPlayers,
                allowAuctions: true,
                allowOwnedPropertyAuctions: true,
                allowMortgage: true,
                rentInJail: false,
                taxInVacationPot: true,
                doubleRentOnMonopoly: true,
                increasingJailFine: false,
            },
            players: {
                [currentPlayerId]: { 
                    id: currentPlayerId, 
                    name: playerName, 
                    money: initialMoney, 
                    position: 0, 
                    animatedPosition: 0, 
                    cities: [], 
                    airports: [], 
                    harbours: [], 
                    companies: [], 
                    inJail: false, 
                    jailTurns: 0, 
                    doublesCount: 0, 
                    onVacation: false, 
                    color: playerColors[0], 
                    getOutOfJailFreeCards: 0,
                    houses: 0,
                    hotels: 0
                }
            },
            turnOrder: [currentPlayerId],
            currentPlayerTurn: currentPlayerId,
            gameLog: [`Game created by ${playerName}.`],
            vacationPot: 0,
            auction: { active: false, log: [], bids: {} },
            trades: {},
            propertyVisits: {},
            jailCount: {}
        };
        try {
            await setDoc(gameRef, newGame);
            window.location.href = `/game/${newRoomId}`;
        } catch (error) {
            console.error("Failed to create game:", error);
            showAlert("Could not create the game. Please check your connection and Firestore rules.");
        }
    };

    const handleJoinGame = async () => {
        if (!playerName || !joinRoomId) return showAlert("Please enter name and room ID.");
        const gameRef = doc(db, "games", joinRoomId.toUpperCase());
        try {
            await runTransaction(db, async (transaction: Transaction) => {
                const gameDoc = await transaction.get(gameRef);
                if (!gameDoc.exists()) throw new Error("Game not found!");
                
                const gameData = gameDoc.data() as GameState;
                if (gameData.status === 'finished') throw new Error("This game has already finished.");
                
                const numPlayers = Object.keys(gameData.players).length;
                if (numPlayers >= gameData.settings.maxPlayers) throw new Error("This game room is full!");
                
                const newPlayerColor = playerColors[numPlayers];
                transaction.update(gameRef, {
                    [`players.${currentPlayerId}`]: { 
                        id: currentPlayerId, 
                        name: playerName, 
                        money: gameData.settings.initialMoney, 
                        position: 0, 
                        animatedPosition: 0,
                        cities: [], 
                        airports: [], 
                        harbours: [], 
                        companies: [], 
                        inJail: false, 
                        jailTurns: 0, 
                        doublesCount: 0, 
                        onVacation: false, 
                        color: newPlayerColor,
                        getOutOfJailFreeCards: 0,
                        houses: 0,
                        hotels: 0
                    },
                    turnOrder: arrayUnion(currentPlayerId),
                    gameLog: arrayUnion(`${playerName} joined the game.`)
                });
            });
            window.location.href = `/game/${joinRoomId.toUpperCase()}`;
        } catch (error) {
            console.error(error);
            if (error instanceof Error) {
                showAlert(error.message);
            } else {
                showAlert("An unknown error occurred.");
            }
        }
    };

    return (
        <div className="max-w-7xl mx-auto">
            <h1 className="text-5xl font-bold text-center mb-8">World Monopoly 🌍</h1>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Actions */}
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                        <h2 className="text-2xl font-semibold mb-4">Create a New Game</h2>
                        <input type="text" placeholder="Enter Your Name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
                        <p className="mb-4">Max Players: 8</p> 
                        <button onClick={handleCreateGame} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-200">Create Game</button>
                    </div>
                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                        <h2 className="text-2xl font-semibold mb-4">Join an Existing Game</h2>
                        <input type="text" placeholder="Enter Your Name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
                        <input type="text" placeholder="Enter 6-Character Room ID" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
                        <button onClick={handleJoinGame} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-200">Join Game</button>
                    </div>
                </div>

                {/* Widgets */}
                <div className="space-y-6">
                    <PlayerProfileWidget currentPlayerId={currentPlayerId} />
                    <ClockWidget />
                    <RulesWidget />
                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                         <h2 className="text-2xl font-semibold mb-4">Admin Panel</h2>
                         <button onClick={() => window.location.href = '/admin'} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition duration-200">Open Admin Dashboard</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ModalProps {
    gameState: GameState;
    roomId: RoomId;
    currentPlayerId: PlayerId;
    showAlert: (message: string) => void;
}

const AuctionModal: FC<ModalProps> = ({ gameState, roomId, currentPlayerId, showAlert }) => {
    const [timer, setTimer] = useState(10);
    const [bidAmount, setBidAmount] = useState<number>(0);
    const { auction } = gameState;
    const property = auction.propertyId ? initialBoardState[auction.propertyId] as CitySquare | UtilitySquare : null;
    const me = gameState.players[currentPlayerId];
    const isSeller = auction.sellerId === currentPlayerId;
    const hasBid = !!auction.bids[currentPlayerId];

    const endAuction = useCallback(async () => {
        if (!property || !auction.propertyId) return;
        const gameRef = doc(db, "games", roomId);
        
        const latestGameDoc = await getDoc(gameRef);
        if (!latestGameDoc.exists()) return;
        const latestGameState = latestGameDoc.data() as GameState;
        const latestAuction = latestGameState.auction;

        const updates: DocumentData = { "auction.active": false };
        let logMessage = "";

        const finalBids = Object.entries(latestAuction.bids || {}).sort(([, a], [, b]) => (b as number) - (a as number));

        if (finalBids.length > 0) {
            const [highestBidderId, finalBidAmount] = finalBids[0];
            const winner = latestGameState.players[highestBidderId];
            const propertyTypeMap: Record<string, keyof Player> = { 'city': 'cities', 'airport': 'airports', 'harbour': 'harbours', 'company': 'companies' };
            const ownershipArray = propertyTypeMap[property.type] as 'cities' | 'airports' | 'harbours' | 'companies';

            updates[`board.${auction.propertyId}.owner`] = highestBidderId;
            updates[`players.${highestBidderId}.${ownershipArray}`] = arrayUnion(auction.propertyId);

            const winnerCurrentMoney = winner.money;
            updates[`players.${highestBidderId}.money`] = winnerCurrentMoney - (finalBidAmount as number);

            if (latestAuction.sellerId) {
                const tax = Math.floor((finalBidAmount as number) * 0.1);
                const sellerGets = (finalBidAmount as number) - tax;
                updates[`players.${latestAuction.sellerId}.money`] = increment(sellerGets);
                if (latestGameState.settings.taxInVacationPot) {
                    updates.vacationPot = increment(tax);
                }
                logMessage = `${winner.name} won the auction for ${property.name} from ${latestGameState.players[latestAuction.sellerId]?.name || 'Unknown'} with a bid of $${finalBidAmount}!`;
            } else {
                logMessage = `${winner.name} won the auction for ${property.name} with a bid of $${finalBidAmount}!`;
            }

        } else {
            logMessage = `Auction for ${property.name} ended with no bids.`;
        }
        updates.gameLog = arrayUnion(logMessage);
        await updateDoc(gameRef, updates);
    }, [auction.propertyId, property, roomId]);


    useEffect(() => {
        if (!auction.active) return;
        setBidAmount(auction.currentBid || 0);
        const interval = setInterval(() => {
            setTimer(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    if (gameState.hostId === currentPlayerId) {
                        endAuction();
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [auction.active, gameState.hostId, currentPlayerId, endAuction, auction.currentBid]);
    
    if (!property) return null;

    const placeBid = async () => {
        if (isSeller || hasBid) return;
        if (bidAmount <= (auction.currentBid || 0)) {
            showAlert("Your bid must be higher than the current highest bid.");
            return;
        }
        if (bidAmount > me.money) {
            showAlert("You cannot bid more money than you have.");
            return;
        }
        
        await updateDoc(doc(db, "games", roomId), {
            [`auction.bids.${currentPlayerId}`]: bidAmount,
            [`auction.log`]: arrayUnion(`${me.name} placed a bid.`),
            [`auction.bidCount`]: increment(1),
            "auction.currentBid": bidAmount,
            "auction.highestBidder": currentPlayerId
        });
    };
    
    const handleCloseAuction = async () => {
        if (currentPlayerId === gameState.hostId && Object.keys(auction.bids).length === 0) {
            await updateDoc(doc(db, "games", roomId), {
                "auction.active": false,
                gameLog: arrayUnion(`Auction for ${property.name} was cancelled.`)
            });
        }
    };
    
    const highestBidderName = gameState.players[auction.highestBidder || '']?.name || 'None';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-8 rounded-lg border border-gray-600 text-center shadow-xl w-1/2 relative">
                <button 
                    onClick={handleCloseAuction} 
                    className="absolute top-2 right-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={currentPlayerId !== gameState.hostId || Object.keys(auction.bids).length > 0}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <h2 className="text-3xl font-bold mb-4">Auction for {property.name}</h2>
                {auction.sellerId && <p className="text-lg text-gray-400 mb-4">Auctioned by {gameState.players[auction.sellerId]?.name}</p>}
                
                <h3 className="text-2xl mb-2">Current Bid: ${auction.currentBid}</h3>
                <p className="mb-4">Highest Bidder: {highestBidderName}</p>
                
                <div className="bg-gray-900 p-4 rounded-lg mb-4 h-48 overflow-y-auto">
                    {auction.log && auction.log.map((log, index) => <p key={index}>{log}</p>)}
                </div>
                
                <h3 className="text-4xl font-mono mb-6">Time Left: {timer}</h3>

                {!isSeller && !hasBid && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <label className="text-lg">Your Bid: ${bidAmount}</label>
                            <input
                                type="range"
                                min={auction.currentBid ? (auction.currentBid as number) + 1 : 0}
                                max={me.money}
                                value={bidAmount}
                                onChange={(e) => setBidAmount(Number(e.target.value))}
                                className="w-full"
                            />
                        </div>
                        <input
                            type="number"
                            min={auction.currentBid ? (auction.currentBid as number) + 1 : 0}
                            max={me.money}
                            value={bidAmount}
                            onChange={(e) => setBidAmount(Number(e.target.value))}
                            className="w-full p-2 bg-gray-700 border border-gray-500 rounded text-white"
                        />
                        <button
                            onClick={placeBid}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded disabled:bg-gray-500 disabled:cursor-not-allowed"
                            disabled={hasBid || isSeller || bidAmount <= (auction.currentBid || 0) || bidAmount > me.money}
                        >
                            Place Bid
                        </button>
                    </div>
                )}
                {hasBid && <p className="text-green-400">You have placed your bid. Waiting for the auction to end.</p>}
                {isSeller && <p className="text-yellow-400">You cannot bid on your own property.</p>}
            </div>
        </div>
    );
};

interface TradeModalProps {
    tradeId?: string;
    setShowTradeModal: (show: string | null) => void;
    gameState: GameState;
    roomId: RoomId;
    currentPlayerId: PlayerId;
    showAlert: (message: string) => void;
}

function TradeModal({ gameState, roomId, currentPlayerId, tradeId, setShowTradeModal, showAlert }: TradeModalProps) {
    const isViewing = !!tradeId;
    const trade = isViewing ? gameState.trades[tradeId] : null;

    const [tradePartnerId, setTradePartnerId] = useState<PlayerId>("");
    const [offer, setOffer] = useState({ money: 0, properties: [] as PropertyId[] });
    const [request, setRequest] = useState({ money: 0, properties: [] as PropertyId[] });

    const me = gameState.players[currentPlayerId];
    const tradePartner = gameState.players[tradePartnerId];

    const getPlayerProperties = (player: Player | undefined): PropertyId[] => {
        if (!player) return [];
        return [...player.cities, ...player.airports, ...player.harbours, ...player.companies];
    };

    const handleSendOffer = async () => {
        if (!tradePartnerId) return showAlert("Please select a player to trade with.");
        const newTradeId = generateId();
        const newTrade: Trade = {
            id: newTradeId,
            fromPlayer: currentPlayerId,
            toPlayer: tradePartnerId,
            offer,
            request,
            status: 'pending'
        };

        await updateDoc(doc(db, "games", roomId), {
            [`trades.${newTradeId}`]: newTrade,
            gameLog: arrayUnion(`${me.name} sent a trade offer to ${tradePartner?.name}.`)
        });
        setShowTradeModal(null);
    };

    const handleAcceptTrade = async () => {
        if (!trade) return;

        const gameRef = doc(db, "games", roomId);
        await runTransaction(db, async (transaction: Transaction) => {
            const gameDoc = await transaction.get(gameRef);
            if (!gameDoc.exists()) throw new Error("Game not found!");
            const gameData = gameDoc.data() as GameState;

            const fromPlayer = gameData.players[trade.fromPlayer];
            const toPlayer = gameData.players[trade.toPlayer];

            if (fromPlayer.money < trade.offer.money || toPlayer.money < trade.request.money) {
                throw new Error("One of the players does not have enough money for this trade.");
            }

            fromPlayer.money = fromPlayer.money - trade.offer.money + trade.request.money;
            toPlayer.money = toPlayer.money + trade.offer.money - trade.request.money;

            const propertyTypeMap: Record<string, 'cities' | 'airports' | 'harbours' | 'companies'> = {
                'city': 'cities',
                'airport': 'airports',
                'harbour': 'harbours',
                'company': 'companies'
            };

            trade.offer.properties.forEach(propId => {
                const propertyType = initialBoardState[propId]?.type;
                if (propertyType && propertyTypeMap[propertyType]) {
                    const propArray = propertyTypeMap[propertyType];
                    fromPlayer[propArray] = fromPlayer[propArray].filter(p => p !== propId);
                    toPlayer[propArray].push(propId);
                    gameData.board[propId].owner = toPlayer.id;
                }
            });

            trade.request.properties.forEach(propId => {
                const propertyType = initialBoardState[propId]?.type;
                if (propertyType && propertyTypeMap[propertyType]) {
                    const propArray = propertyTypeMap[propertyType];
                    toPlayer[propArray] = toPlayer[propArray].filter(p => p !== propId);
                    fromPlayer[propArray].push(propId);
                    gameData.board[propId].owner = fromPlayer.id;
                }
            });

            transaction.update(gameRef, {
                players: gameData.players,
                board: gameData.board,
                [`trades.${trade.id}`]: deleteField(),
                gameLog: arrayUnion(`${toPlayer.name} accepted the trade from ${fromPlayer.name}.`)
            });
        });

        setShowTradeModal(null);
    };


    const handleRejectTrade = async () => {
        if (!trade) return;
        await updateDoc(doc(db, "games", roomId), {
            [`trades.${trade.id}`]: deleteField(),
            gameLog: arrayUnion(`${me.name} rejected the trade.`)
        });
        setShowTradeModal(null);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 shadow-xl w-full max-w-3xl relative">
                <button onClick={() => setShowTradeModal(null)} className="absolute top-2 right-2 text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {isViewing && trade ? (
                     <div>
                        <h2 className="text-2xl font-bold mb-4 text-center">Trade Offer from {gameState.players[trade.fromPlayer].name}</h2>
                        <div className="flex gap-6">
                            <div className="flex-1 border border-gray-600 p-4 rounded-lg">
                                <h3 className="text-xl font-semibold mb-2 text-center">They Offer</h3>
                                <p>Money: ${trade.offer.money}</p>
                                <ul className="list-disc list-inside mt-2">
                                    {trade.offer.properties.map(p => <li key={p}>{initialBoardState[p]?.name || 'Unknown Property'}</li>)}
                                </ul>
                            </div>
                            <div className="flex-1 border border-gray-600 p-4 rounded-lg">
                                <h3 className="text-xl font-semibold mb-2 text-center">They Request</h3>
                                <p>Money: ${trade.request.money}</p>
                                <ul className="list-disc list-inside mt-2">
                                    {trade.request.properties.map(p => <li key={p}>{initialBoardState[p]?.name || 'Unknown Property'}</li>)}
                                </ul>
                            </div>
                        </div>
                        <div className="flex justify-center gap-4 mt-6">
                            <button onClick={handleAcceptTrade} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded">Accept</button>
                            <button onClick={handleRejectTrade} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded">Reject</button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <h2 className="text-2xl font-bold mb-4 text-center">Propose a Trade</h2>
                        <select onChange={(e) => setTradePartnerId(e.target.value)} value={tradePartnerId} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white">
                            <option value="">Select a player...</option>
                            {Object.values(gameState.players).filter(p => p.id !== currentPlayerId).map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {tradePartner && (
                             <div className="flex gap-6">
                                <div className="flex-1 border border-gray-600 p-4 rounded-lg">
                                    <h3 className="text-xl font-semibold mb-2 text-center">Your Offer</h3>
                                    <label className="block mb-2">Money: ${offer.money}</label>
                                    <input type="range" min="0" max={me.money} value={offer.money} onChange={(e) => setOffer({...offer, money: Number(e.target.value)})} className="w-full" />
                                    <div className="h-40 overflow-y-auto mt-4 p-2 bg-gray-700 rounded">
                                        {getPlayerProperties(me).map(propId => (
                                            <label key={propId} className="flex items-center space-x-2">
                                                <input type="checkbox" className="form-checkbox" onChange={(e) => {
                                                    const newProps = e.target.checked ? [...offer.properties, propId] : offer.properties.filter(p => p !== propId);
                                                    setOffer({...offer, properties: newProps});
                                                }}/> <span>{initialBoardState[propId]?.name || 'Unknown Property'}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex-1 border border-gray-600 p-4 rounded-lg">
                                    <h3 className="text-xl font-semibold mb-2 text-center">Their Request</h3>
                                    <label className="block mb-2">Money: ${request.money}</label>
                                    <input type="range" min="0" max={tradePartner.money} value={request.money} onChange={(e) => setRequest({...request, money: Number(e.target.value)})} className="w-full" />
                                    <div className="h-40 overflow-y-auto mt-4 p-2 bg-gray-700 rounded">
                                        {getPlayerProperties(tradePartner).map(propId => (
                                            <label key={propId} className="flex items-center space-x-2">
                                                <input type="checkbox" className="form-checkbox" onChange={(e) => {
                                                    const newProps = e.target.checked ? [...request.properties, propId] : request.properties.filter(p => p !== propId);
                                                    setRequest({...request, properties: newProps});
                                                }}/> <span>{initialBoardState[propId]?.name || 'Unknown Property'}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="flex justify-center gap-4 mt-6">
                            <button onClick={handleSendOffer} disabled={!tradePartnerId} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded disabled:bg-gray-500">Send Offer</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface TradesWidgetProps {
    gameState: GameState;
    currentPlayerId: PlayerId;
    onViewTrade: (tradeId: string) => void;
}

const TradesWidget: FC<TradesWidgetProps> = ({ gameState, currentPlayerId, onViewTrade }) => {
    const pendingTrades = Object.values(gameState.trades || {}).filter(t => t.status === 'pending');

    const handleCancelTrade = async (tradeId: string) => {
        if (window.confirm("Are you sure you want to cancel this trade offer?")) {
            await updateDoc(doc(db, "games", gameState.gameId), {
                [`trades.${tradeId}`]: deleteField(),
                gameLog: arrayUnion(`${gameState.players[currentPlayerId].name} cancelled a trade offer.`)
            });
        }
    };

    return (
        <div className="bg-gray-700 p-2 rounded mb-3">
            <h2 className="text-base font-semibold mb-2">Open Trades</h2>
            <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                {pendingTrades.length > 0 ? pendingTrades.map(trade => {
                    const fromPlayer = gameState.players[trade.fromPlayer];
                    const toPlayer = gameState.players[trade.toPlayer];
                    return (
                        <div key={trade.id} className="bg-gray-800 p-2 rounded-md border border-gray-600 text-xs">
                            <p><strong>From:</strong> {fromPlayer.name}</p>
                            <p><strong>To:</strong> {toPlayer.name}</p>
                            {currentPlayerId === trade.toPlayer && (
                                <button onClick={() => onViewTrade(trade.id)} className="w-full mt-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-xs">
                                    View Offer
                                </button>
                            )}
                             {currentPlayerId === trade.fromPlayer && (
                                <button onClick={() => handleCancelTrade(trade.id)} className="w-full mt-1 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs">
                                    Cancel Offer
                                </button>
                            )}
                        </div>
                    );
                }) : <p className="text-xs text-gray-400">No open trades.</p>}
            </div>
        </div>
    );
};


interface StatsModalProps {
    gameState: GameState;
    onClose: () => void;
}

const StatsModal: FC<StatsModalProps> = ({ gameState, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 shadow-xl w-full max-w-4xl h-3/4 relative flex flex-col">
                <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <h2 className="text-3xl font-bold mb-4 text-center">Property Statistics</h2>
                <div className="overflow-y-auto flex-grow pr-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.values(gameState.players).map(player => {
                            const allProperties = [...player.cities, ...player.airports, ...player.harbours, ...player.companies];
                            return (
                                <div key={player.id} className="bg-gray-700 border border-gray-600 p-3 rounded-lg">
                                    <h3 className="text-xl font-semibold mb-2" style={{ color: player.color }}>{player.name}</h3>
                                    <p className="mb-2">Money: ${player.money}</p>
                                    {allProperties.length > 0 ? (
                                        <ul className="list-disc list-inside text-sm space-y-1">
                                            {allProperties.map(propId => (
                                                <li key={propId}>{initialBoardState[propId]?.name || 'Unknown Property'}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-400">No properties owned.</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface VisitStatsModalProps {
    gameState: GameState;
    onClose: () => void;
}

const VisitStatsModal: FC<VisitStatsModalProps> = ({ gameState, onClose }) => {
    const sortedVisits = Object.entries(gameState.propertyVisits || {}).sort(([, a], [, b]) => (b as number) - (a as number));

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 shadow-xl w-full max-w-md h-3/4 relative flex flex-col">
                <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <h2 className="text-3xl font-bold mb-4 text-center">Property Visit Statistics</h2>
                <div className="overflow-y-auto flex-grow pr-4">
                    <ul className="space-y-2">
                        {sortedVisits.map(([propId, count]) => (
                            <li key={propId} className="flex justify-between items-center bg-gray-700 p-2 rounded">
                                <span className="font-semibold">{initialBoardState[propId]?.name || 'Unknown Property'}</span>
                                <span className="text-lg font-bold text-cyan-400">{count}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};


interface BoardProps {
    gameState: GameState;
    currentPlayerId: PlayerId;
    roomId: RoomId;
    showAlert: (message: string) => void;
}
interface CardPopupProps {
    card: Card;
    onClose: () => void;
}
const CardPopup: FC<CardPopupProps> = ({ card, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 20000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 text-center shadow-xl w-96 relative">
                <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-white bg-transparent border-none opacity-50">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <h2 className="text-2xl font-bold mb-2">{card.type === 'treasure' ? 'Treasure Chest' : 'Surprise'}</h2>
                <p>{card.text}</p>
            </div>
        </div>
    );
};

const Board: FC<BoardProps> = ({ gameState, currentPlayerId, roomId, showAlert }) => {
    const { players } = gameState;
    const [activePopups, setActivePopups] = useState<Record<string, boolean>>({});
    const popupTimers = useRef<Record<string, NodeJS.Timeout>>({});
    const [auctioningProperty, setAuctioningProperty] = useState<PropertyId | null>(null);
    const [startingBid, setStartingBid] = useState(0);

    const handleStartAuction = (propertyId: PropertyId) => {
        setAuctioningProperty(propertyId);
        const property = initialBoardState[propertyId] as CitySquare | UtilitySquare;
        setStartingBid(Math.floor(property.cost / 2));
    };

    const confirmStartAuction = async () => {
        if (auctioningProperty) {
            const result = await startAuction(roomId, auctioningProperty, startingBid, currentPlayerId);
            if (result) {
                showAlert(result);
            }
            setAuctioningProperty(null);
        }
    };


    const togglePopup = (i: number) => {
        Object.values(popupTimers.current).forEach(clearTimeout);
        popupTimers.current = {};
    
        setActivePopups(prev => {
            const isActive = !!prev[String(i)];
            if (isActive) {
                return {};
            } else {
                const newActivePopups = { [String(i)]: true };
                popupTimers.current[String(i)] = setTimeout(() => {
                    setActivePopups({});
                }, 10000);
                return newActivePopups;
            }
        });
    };


    const getGridPosition = (i: number): React.CSSProperties => {
        let row, col;
        if (i >= 0 && i <= 14) { row = 15; col = 15 - i; }
        else if (i >= 15 && i <= 28) { row = 15 - (i - 14); col = 1; }
        else if (i >= 29 && i <= 42) { row = 1; col = 1 + (i - 28); }
        else { row = 1 + (i - 42); col = 15; }
        return { gridArea: `${row} / ${col}` };
    };

    const renderHouses = (houses: number, hotels: number) => {
        if (hotels > 0) {
            return '🏨';
        }
        if (houses > 0) {
            return '🏠'.repeat(houses);
        }
        return null;
    };

    const cells = Array.from({ length: 56 }, (_, i) => {
        const cellInfo = initialBoardState[String(i)] as CitySquare | UtilitySquare | TaxSquare | BaseSquare;
        const cellState = gameState.board[String(i)];
        const isCorner = [0, 14, 28, 42].includes(i);
        const hasColorBar = cellInfo.type === 'city';
        const flagSvg = hasColorBar ? countryFlags[(cellInfo as CitySquare).country] : null;
        const owner = cellState?.owner ? players[cellState.owner] : null;
        const ownerColor = owner?.color;
        const isMyProperty = cellState?.owner === currentPlayerId;
        
        const isLeftSide = i >= 15 && i <= 27;
        const isRightSide = i >= 43 && i <= 55;
        const isTopSide = i >= 29 && i <= 41;
        const isBottomSide = i >= 1 && i <= 13;
        
        const wrapperStyle: React.CSSProperties = {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            height: '100%',
            position: 'relative',
        };

        let popupPositionClass = '';
        if (isLeftSide) {
            wrapperStyle.transform = 'rotate(90deg)';
            wrapperStyle.width = '40px';
            wrapperStyle.height = '80px';
            popupPositionClass = 'left-full top-0 ml-2';
        }
        if (isRightSide) {
            wrapperStyle.transform = 'rotate(-90deg)';
            wrapperStyle.width = '40px';
            wrapperStyle.height = '80px';
            popupPositionClass = 'right-full top-0 mr-2';
        }
        if (isTopSide) {
            popupPositionClass = 'top-full mt-2';
        }
        if (isBottomSide) {
            popupPositionClass = 'bottom-full mb-2';
        }

        if (cellInfo.type === 'jail') {
            return (
                <div key={i} className="bg-gray-700 border border-gray-500 relative flex justify-center items-center text-center font-bold" style={getGridPosition(i)}>
                    <div className="w-full h-full relative">
                        <div className="absolute bottom-1 left-1 text-[7px] font-bold">Just Visiting</div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-1 w-16 justify-center">
                            {Object.values(players).map(p => 
                                p.animatedPosition === i && !p.inJail && <div key={p.id} className="w-3.5 h-3.5 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                            )}
                        </div>
                    </div>
                    <div className="absolute top-1 right-1 w-3/5 h-3/5 bg-red-800 bg-opacity-50 text-white flex justify-center items-center text-[10px] font-bold border border-red-500">
                        IN JAIL
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-1 w-16 justify-center">
                            {Object.values(players).map(p => 
                                p.animatedPosition === i && p.inJail && <div key={p.id} className="w-3.5 h-3.5 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        if (cellInfo.type === 'vacation') {
            return (
                <div key={i} className={`bg-gray-700 border border-gray-500 relative flex justify-center items-center text-center box-border group ${isCorner ? 'font-bold' : ''}`} style={getGridPosition(i)}>
                    <div className="content-wrapper" style={wrapperStyle}>
                        <div className="p-0.5 flex-grow flex items-center justify-center text-[9px]">{cellInfo.name}</div>
                        <div className="text-[10px] font-bold pb-1">${gameState.vacationPot || 0}</div>
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-1 w-16 justify-center">
                        {Object.values(players).map(p =>
                            p.animatedPosition === i && <div key={p.id} className="w-3.5 h-3.5 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div key={i} onClick={() => togglePopup(i)} className={`bg-gray-700 border border-gray-500 relative flex justify-center items-center text-[8px] text-center box-border group ${isCorner ? 'font-bold' : ''}`} style={getGridPosition(i)}>
                <div className="content-wrapper" style={wrapperStyle}>
                    {hasColorBar && <div className="w-full h-4 border-b border-gray-500 overflow-hidden">{flagSvg}</div>}
                    <div className="p-0.5 flex-grow flex items-center justify-center">{cellInfo.name}</div>
                    
                    {!cellState?.owner && (cellInfo as UtilitySquare).cost && <div className="text-[9px] font-bold pb-1">${(cellInfo as UtilitySquare).cost}</div>}
                    
                    {ownerColor && (
                        <div className="w-full h-4 border-t border-gray-500 flex justify-center items-center" style={{ backgroundColor: ownerColor }}>
                            <span className="text-[6px]">{renderHouses(cellState.houses, cellState.hotels)}</span>
                        </div>
                    )}
                </div>
                {cellState?.mortgaged && <div className="absolute text-3xl text-red-500 text-opacity-70 font-bold">$</div>}
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-1 w-16 justify-center">
                    {Object.values(players).map(p => 
                        p.animatedPosition === i && <div key={p.id} className="w-3.5 h-3.5 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                    )}
                </div>
                {(cellInfo.type === 'city' || cellInfo.type === 'airport' || cellInfo.type === 'harbour' || cellInfo.type === 'company') && (
                    <div className={`absolute z-10 bg-purple-900 bg-opacity-95 ${activePopups[String(i)] ? 'flex' : 'hidden'} flex-col items-center justify-center p-2 text-white text-[10px] w-48 h-auto rounded-lg shadow-lg ${popupPositionClass}`}>
                        <button onClick={(e) => { e.stopPropagation(); togglePopup(i); }} className="absolute top-1 right-1 text-gray-400 hover:text-white bg-transparent border-none">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <h4 className="font-bold mb-1 text-xs">{cellInfo.name}</h4>
                        {owner && <p className="text-[9px] mb-1">Owned by: {owner.name}</p>}
                        {cellInfo.type === 'city' && (
                            <table className="w-full text-left text-[9px] mb-1">
                                <tbody>
                                    <tr><td>Rent</td><td>${(cellInfo as CitySquare).rent[0]}</td></tr>
                                    <tr><td>1 House</td><td>${(cellInfo as CitySquare).rent[1]}</td></tr>
                                    <tr><td>2 Houses</td><td>${(cellInfo as CitySquare).rent[2]}</td></tr>
                                    <tr><td>3 Houses</td><td>${(cellInfo as CitySquare).rent[3]}</td></tr>
                                    <tr><td>4 Houses</td><td>${(cellInfo as CitySquare).rent[4]}</td></tr>
                                    <tr><td>Hotel</td><td>${(cellInfo as CitySquare).rent[5]}</td></tr>
                                </tbody>
                            </table>
                        )}
                         {cellInfo.type === 'airport' && (
                             <table className="w-full text-left text-[9px] mb-1">
                                <tbody>
                                    <tr><td>1 Owned</td><td>${(cellInfo as UtilitySquare).rent[0]}</td></tr>
                                    <tr><td>2 Owned</td><td>${(cellInfo as UtilitySquare).rent[1]}</td></tr>
                                    <tr><td>3 Owned</td><td>${(cellInfo as UtilitySquare).rent[2]}</td></tr>
                                    <tr><td>4 Owned</td><td>${(cellInfo as UtilitySquare).rent[3]}</td></tr>
                                </tbody>
                            </table>
                        )}
                        {cellInfo.type === 'harbour' && (
                             <table className="w-full text-left text-[9px] mb-1">
                                <tbody>
                                    <tr><td>1 Owned</td><td>$50</td></tr>
                                    <tr><td>2 Owned</td><td>$100</td></tr>
                                    <tr><td>3 Owned</td><td>$150</td></tr>
                                    <tr><td>4 Owned</td><td>$200</td></tr>
                                </tbody>
                            </table>
                        )}
                        {cellInfo.type === 'company' && (
                            <>
                                <p className="text-[10px] font-semibold">Rent with 1 owned: 4x Dice Roll</p>
                                <p className="text-[10px] font-semibold">Rent with 2 owned: 10x Dice Roll</p>
                            </>
                        )}
                        {isMyProperty && (
                            <>
                                <button 
                                    onClick={async () => {
                                        const result = await (cellState.mortgaged ? unmortgageProperty(roomId, currentPlayerId, String(i), gameState) : mortgageProperty(roomId, currentPlayerId, String(i), gameState));
                                        if (result) showAlert(result);
                                    }} 
                                    disabled={!gameState.settings.allowMortgage}
                                    className="w-full text-center py-1 bg-yellow-600 hover:bg-yellow-700 rounded mb-1 text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">
                                        {cellState.mortgaged ? `Unmortgage ($${Math.ceil(((cellInfo as UtilitySquare).cost / 2) * 1.1)})` : `Mortgage ($${(cellInfo as UtilitySquare).cost / 2})`}
                                </button>
                                {cellInfo.type === 'city' && !cellState.mortgaged && (
                                    <div className="flex w-full gap-1 mb-1">
                                        <button onClick={async () => {
                                            const result = await buildHouse(roomId, currentPlayerId, String(i), gameState);
                                            if (result) showAlert(result);
                                        }} className="flex-1 text-center py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs">Build</button>
                                        <button onClick={async () => {
                                            const result = await sellHouse(roomId, currentPlayerId, String(i), gameState);
                                            if (result) showAlert(result);
                                        }} className="flex-1 text-center py-1 bg-orange-600 hover:bg-orange-700 rounded text-xs">Sell</button>
                                    </div>
                                )}
                                {cellState && !cellState.mortgaged && cellState.houses === 0 && cellState.hotels === 0 && (
                                    <button 
                                        onClick={async () => {
                                            const result = await sellProperty(roomId, currentPlayerId, String(i), gameState);
                                            if (result) showAlert(result);
                                        }}
                                        className="w-full text-center py-1 bg-red-600 hover:bg-red-700 rounded mb-1 text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">
                                        Sell Property
                                    </button>
                                )}
                                <button 
                                    onClick={() => handleStartAuction(String(i))} 
                                    disabled={!gameState.settings.allowOwnedPropertyAuctions}
                                    className="w-full text-center py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">
                                    Auction
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    });

    return (
        <div className="flex justify-center items-center p-2">
            <div className="grid grid-cols-[80px_repeat(13,_40px)_80px] grid-rows-[80px_repeat(13,_40px)_80px] gap-0.5 bg-black border-2 border-gray-500 relative">
                {cells}
                {auctioningProperty && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
                    <div className="bg-gray-800 p-8 rounded-lg border border-gray-600 text-center shadow-xl w-1/2">
                        <h2 className="text-3xl font-bold mb-4">Set Starting Bid</h2>
                        <p className="text-lg text-gray-400 mb-4">Property: {initialBoardState[auctioningProperty].name}</p>
                        <input
                            type="number"
                            value={startingBid}
                            onChange={(e) => setStartingBid(Number(e.target.value))}
                            className="w-full p-2 bg-gray-700 border border-gray-500 rounded text-white mb-4"
                        />
                        <div className="flex justify-center gap-4">
                            <button onClick={confirmStartAuction} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded">Start Auction</button>
                            <button onClick={() => setAuctioningProperty(null)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
                <div 
                    className="bg-[#3a4d3b] p-4 box-border flex items-center justify-center" 
                    style={{ gridColumn: '2 / 15', gridRow: '2 / 15' }}
                >
                    <div className="w-full h-full overflow-y-auto p-2.5 bg-green-900 bg-opacity-20 rounded text-gray-100">
                       {gameState.gameLog.slice().reverse().map((msg: string, i: number) => <p key={i} className="m-0 mb-1.5 pb-1.5 border-b border-dotted border-gray-500 text-sm">{msg}</p>)}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface DeleteConfirmModalProps {
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmModal: FC<DeleteConfirmModalProps> = ({ onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 shadow-xl w-full max-w-sm relative">
                <button onClick={onCancel} className="absolute top-2 right-2 text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <h2 className="text-2xl font-bold mb-4 text-center">Delete Game</h2>
                <p className="text-center text-gray-300 mb-6">Are you sure you want to delete this game? This action cannot be undone.</p>
                <div className="flex justify-center gap-4">
                    <button onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded">OK</button>
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded">Cancel</button>
                </div>
            </div>
        </div>
    );
};

interface GameRoomProps {
    roomId: RoomId;
    currentPlayerId: PlayerId;
    showAlert: (message: string) => void;
}

const GameRoom: FC<GameRoomProps> = ({ roomId, currentPlayerId, showAlert }) => {
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [activeTradeModal, setActiveTradeModal] = useState<string | null>(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [hasRolled, setHasRolled] = useState(false);
    const [lastDiceRoll, setLastDiceRoll] = useState(0);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showVisitStatsModal, setShowVisitStatsModal] = useState(false);
    const [showCardPopup, setShowCardPopup] = useState(false);
    
    useEffect(() => {
        const gameRef = doc(db, "games", roomId);
        const unsubscribe = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as GameState;
                setGameState(data);
                if (data.drawnCard) {
                    setShowCardPopup(true);
                }
            } else {
                // This is handled by the loading/error state below
            }
        });
        return () => unsubscribe();
    }, [roomId]);
    
    const me = gameState?.players[currentPlayerId];

    useEffect(() => {
        setHasRolled(false);
    }, [gameState?.currentPlayerTurn]);

    useEffect(() => {
        if (hasRolled) {
            const handleLanding = async () => {
                const gameDoc = await getDoc(doc(db, "games", roomId));
                if (!gameDoc.exists()) return;
                
                const latestGameState = gameDoc.data() as GameState;
                const latestMe = latestGameState.players[currentPlayerId];

                if (latestGameState.currentPlayerTurn === currentPlayerId && latestMe) {
                    await handleLandingOnSquare(roomId, currentPlayerId, latestMe.position, lastDiceRoll, latestGameState);
                }
            };
            handleLanding();
        }
    }, [hasRolled, roomId, currentPlayerId, lastDiceRoll]);

    const handleStartGame = async () => {
        if (!gameState || gameState.hostId !== currentPlayerId) return showAlert("Only the admin can start the game.");
        
        const shuffledTurnOrder = [...gameState.turnOrder].sort(() => Math.random() - 0.5);

        await updateDoc(doc(db, "games", roomId), { 
            status: "in-progress",
            turnOrder: shuffledTurnOrder,
            currentPlayerTurn: shuffledTurnOrder[0],
            gameLog: arrayUnion("The game has started! Turn order is randomized.")
        });
    };

    const handleRollDice = async () => {
        if (!gameState || !me || gameState.currentPlayerTurn !== currentPlayerId) return showAlert("It's not your turn!");
        
        if (me.inJail) {
            const die1 = Math.floor(Math.random() * 6) + 1;
            const die2 = Math.floor(Math.random() * 6) + 1;
            const diceRoll = die1 + die2;
            setLastDiceRoll(diceRoll);
            const isDoubles = die1 === die2;
            let logMessage = `${me.name} rolled a ${die1} and a ${die2}.`;
    
            if (isDoubles) {
                logMessage += ' Doubles! You are free from jail!';
                await updateDoc(doc(db, "games", roomId), {
                    [`players.${currentPlayerId}.inJail`]: false,
                    [`players.${currentPlayerId}.jailTurns`]: 0,
                    [`players.${currentPlayerId}.position`]: (me.position + diceRoll) % 56,
                    [`players.${currentPlayerId}.animatedPosition`]: (me.position + diceRoll) % 56,
                    gameLog: arrayUnion(logMessage)
                });
                setHasRolled(true);
            } else {
                logMessage += ' Not doubles. Your turn in jail ends.';
                await updateDoc(doc(db, "games", roomId), {
                    gameLog: arrayUnion(logMessage)
                });
                await handleEndTurn();
            }
            return;
        }

        if (me.onVacation) {
            showAlert("You are on vacation and must skip this turn. Click 'End Turn' to proceed.");
            return;
        }
    
        let doublesCount = me.doublesCount || 0;
    
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const diceRoll = die1 + die2;
        setLastDiceRoll(diceRoll);
        const isDoubles = die1 === die2;
    
        if (isDoubles) doublesCount++;
        else doublesCount = 0;
    
        if (doublesCount === 3) {
            await goToJail(roomId, currentPlayerId, gameState);
            setHasRolled(true);
            return;
        }
    
        const oldPosition = me.position;
        const newPosition = (oldPosition + diceRoll) % 56;
    
        const updates: DocumentData = {
            [`players.${currentPlayerId}.position`]: newPosition,
            [`players.${currentPlayerId}.animatedPosition`]: newPosition,
            [`players.${currentPlayerId}.doublesCount`]: doublesCount,
        };
        
        const logMessages = [`${me.name} rolled a ${die1} and a ${die2}.`];
    
        if (newPosition < oldPosition && newPosition !== 0 && !me.inJail) {
            updates[`players.${currentPlayerId}.money`] = increment(200);
            logMessages.push(`${me.name} passed GO and collected $200.`);
        }
        
        updates.gameLog = arrayUnion(...logMessages);
    
        await updateDoc(doc(db, "games", roomId), updates);
        
        setHasRolled(true);
    };

    const handleEndTurn = async () => {
        if (!gameState) return;
        const { turnOrder, currentPlayerTurn } = gameState;
        const player = gameState.players[currentPlayerTurn];
        
        if (player.money < 0) {
            showAlert("You must resolve your debt by selling houses or mortgaging properties before ending your turn.");
            return;
        }
    
        const updates: DocumentData = {
            [`players.${currentPlayerTurn}.doublesCount`]: 0,
        };

        if (player.inJail) {
            if (player.jailTurns >= 3) {
                updates[`players.${currentPlayerTurn}.inJail`] = false;
                updates[`players.${currentPlayerTurn}.jailTurns`] = 0;
                updates.gameLog = arrayUnion(`${player.name} is free from jail after 3 turns.`);
            } else {
                updates[`players.${currentPlayerTurn}.jailTurns`] = increment(1);
            }
        }
    
        if (turnOrder.length > 1) {
            const currentIndex = turnOrder.indexOf(currentPlayerTurn);
            const nextPlayerId = turnOrder[(currentIndex + 1) % turnOrder.length];
            updates.currentPlayerTurn = nextPlayerId;
        }
    
        if (player.onVacation) {
            updates[`players.${currentPlayerTurn}.onVacation`] = false;
        }
        
        updates.gameLog = arrayUnion(`${player.name}'s turn ended.`);
        await updateDoc(doc(db, "games", roomId), updates);
    
        if (turnOrder.length === 1) {
            setHasRolled(false);
        }
    };

    const handleDeleteGame = () => {
        setShowDeleteConfirmModal(true);
    };

    const confirmDeleteGame = async () => {
        await deleteDoc(doc(db, "games", roomId));
        setShowDeleteConfirmModal(false);
        window.location.href = '/';
    };
    
    if (!gameState) {
        return (
            <div className="text-center text-xl">
                <p>Joining game...</p>
                <p className="text-sm text-gray-400 mt-2">(If this takes more than a few seconds, the game ID might be invalid.)</p>
            </div>
        );
    }

    if (gameState.status === 'finished') {
        const winnerName = gameState.winner ? (gameState.players[gameState.winner]?.name || "N/A") : "N/A";
        return (
            <div className="max-w-4xl mx-auto text-center">
                <h1 className="text-4xl font-bold mb-4">Game Over!</h1>
                <h2 className="text-3xl mb-8">Winner: {winnerName}</h2>
                <a href="/" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Back to Lobby</a>
            </div>
        );
    }
    
    if (!me) {
        return (
            <div className="max-w-4xl mx-auto text-center">
                <h1 className="text-4xl font-bold mb-4">You have been eliminated!</h1>
                <p className="text-lg mb-8">Thanks for playing.</p>
                <a href="/" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Back to Lobby</a>
            </div>
        );
    }

    const currentSquareInfo = initialBoardState[String(me.position)];
    const currentSquareState = gameState.board[String(me.position)];
    const canBuy = ['city', 'airport', 'harbour', 'company'].includes(currentSquareInfo?.type) && !currentSquareState?.owner;
    const amIOnTurn = gameState.currentPlayerTurn === currentPlayerId;
    const jailFine = gameState.settings.increasingJailFine ? 100 + ((gameState.jailCount?.[currentPlayerId] || 0) - 1) * 20 : 100;

    return (
        <div className="max-w-5xl mx-auto">
            <div className="flex flex-col lg:flex-row gap-4 items-start">
                <Board gameState={gameState} currentPlayerId={currentPlayerId} roomId={roomId} showAlert={showAlert} />
                <div className="flex-shrink-0 w-full lg:w-64 bg-gray-800 p-3 rounded-lg border border-gray-600 shadow-lg">
                    <h1 className="text-lg font-bold mb-2">Room: {roomId}</h1>
                    <div className="bg-gray-700 p-2 rounded mb-3">
                        <p className="text-xs"><strong>Admin:</strong> {gameState.players[gameState.hostId]?.name || 'N/A'}</p>
                        <p className="text-xs"><strong>Vacation Pot:</strong> ${gameState.vacationPot || 0}</p>
                    </div>

                    {gameState.status === "waiting" && currentPlayerId === gameState.hostId && (
                        <div className="flex gap-2 mb-3">
                            <button onClick={handleStartGame} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 px-3 rounded text-xs">Start Game</button>
                            <button onClick={handleDeleteGame} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-3 rounded text-xs">Delete Game</button>
                        </div>
                    )}
                    
                    <AdminSettingsWidget gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} showAlert={showAlert} />

                    <h2 className="text-base font-semibold mb-2">Players</h2>
                    <div className="space-y-2 mb-3">
                        {Object.values(gameState.players).map(p => (
                            <div key={p.id} className={`flex items-center border border-gray-700 p-2 rounded-md transition-all duration-200 ${p.id === gameState.currentPlayerTurn ? 'border-l-4 border-green-500 shadow-lg bg-gray-700' : ''}`}>
                                <div className="w-3.5 h-3.5 rounded-full mr-2" style={{backgroundColor: p.color}}></div>
                                <div>
                                    <strong className="text-xs">{p.name} {p.id === currentPlayerId ? '(You)' : ''}</strong>
                                    <p className="text-xs">Money: ${p.money}</p>
                                    {p.inJail && <p className="text-red-400 text-[10px]">In Jail (Turn {p.jailTurns})</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <h2 className="text-base font-semibold mb-2">Your Turn</h2>
                    {amIOnTurn && gameState.status === 'in-progress' && (
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {!me.inJail && !hasRolled && !me.onVacation && (
                                <button onClick={handleRollDice} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-xs">
                                    {me.doublesCount > 0 ? "Roll Again" : "Roll Dice"}
                                </button>
                            )}
                            {me.inJail && !hasRolled && (
                                <>
                                    <p className="col-span-2 text-center text-yellow-400 text-xs">You are in Jail. Turn {me.jailTurns} of 3</p>
                                    <button onClick={handleRollDice} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-xs">Roll for Doubles</button>
                                    <button onClick={async() => {
                                        const result = await payJailFine(roomId, currentPlayerId, gameState);
                                        if(result) showAlert(result);
                                    }} disabled={me.money < jailFine} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-3 rounded text-xs">Pay ${jailFine} Fine</button>
                                    <button onClick={async () => {
                                        const result = await handleUsePardonCard(roomId, currentPlayerId, gameState);
                                        if (result) showAlert(result);
                                    }} disabled={me.getOutOfJailFreeCards === 0} className="col-span-2 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">Use Get Out of Jail Free Card</button>
                                </>
                            )}
                            {me.doublesCount > 0 && !hasRolled && <p className="text-green-400 col-span-2 text-center text-xs">You rolled doubles! Roll again.</p>}

                            {hasRolled && !me.onVacation && !me.inJail && (
                                <>
                                    {canBuy && <button onClick={async () => {
                                        const result = await buyProperty(roomId, currentPlayerId, me.position, gameState);
                                        if(result) showAlert(result);
                                    }} className="bg-green-500 hover:bg-green-600 text-white font-bold py-1.5 px-3 rounded text-xs">Buy</button>}
                                    {canBuy && <button onClick={async () => {
                                        const result = await startAuction(roomId, String(me.position), Math.floor((initialBoardState[String(me.position)] as UtilitySquare).cost / 2));
                                        if (result) showAlert(result);
                                    }} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-1.5 px-3 rounded text-xs">Auction</button>}
                                    
                                    {me.doublesCount === 0 ? (
                                        <button onClick={handleEndTurn} disabled={me.money < 0} className="col-span-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-700 disabled:cursor-not-allowed">End Turn</button>
                                    ) : (
                                        <button onClick={() => setHasRolled(false)} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-xs">Continue</button>
                                    )}
                                </>
                            )}
                            
                            {me.onVacation && (
                                <button onClick={handleEndTurn} className="col-span-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-1.5 px-3 rounded text-xs">End Turn</button>
                            )}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <button onClick={() => handleBankruptcy(roomId, currentPlayerId, gameState)} disabled={gameState.status !== 'in-progress'} className="bg-red-700 hover:bg-red-800 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">Bankruptcy</button>
                        <button onClick={() => setActiveTradeModal('new')} disabled={gameState.status !== 'in-progress'} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">Propose Trade</button>
                        <button onClick={() => setShowStatsModal(true)} disabled={gameState.status !== 'in-progress'} className="col-span-2 bg-teal-600 hover:bg-teal-700 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">Property Stats</button>
                        <button onClick={() => setShowVisitStatsModal(true)} disabled={gameState.status !== 'in-progress'} className="col-span-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-1.5 px-3 rounded text-xs disabled:bg-gray-500 disabled:cursor-not-allowed">Visit Stats</button>
                    </div>

                    {gameState.status === 'in-progress' && <TradesWidget gameState={gameState} currentPlayerId={currentPlayerId} onViewTrade={(tradeId) => setActiveTradeModal(tradeId)} />}
                    
                </div>
            </div>
            {activeTradeModal && <TradeModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} setShowTradeModal={setActiveTradeModal} tradeId={activeTradeModal === 'new' ? undefined : activeTradeModal} showAlert={showAlert} />}
            {gameState.auction?.active && <AuctionModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} showAlert={showAlert} />}
            {showDeleteConfirmModal && <DeleteConfirmModal onConfirm={confirmDeleteGame} onCancel={() => setShowDeleteConfirmModal(false)} />}
            {showStatsModal && <StatsModal gameState={gameState} onClose={() => setShowStatsModal(false)} />}
            {showVisitStatsModal && <VisitStatsModal gameState={gameState} onClose={() => setShowVisitStatsModal(false)} />}
            {showCardPopup && gameState.drawnCard && (
                <CardPopup
                    card={gameState.drawnCard}
                    onClose={() => {
                        setShowCardPopup(false);
                        updateDoc(doc(db, "games", roomId), { drawnCard: deleteField() });
                    }}
                />
            )}
        </div>
    );
};

interface AdminDashboardProps {
    showAlert: (message: string) => void;
}

const AdminDashboard: FC<AdminDashboardProps> = ({ showAlert }) => {
    const [games, setGames] = useState<GameState[]>([]);
    const [password, setPassword] = useState("");
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const handleAdminLogin = () => {
        if (password === "admin123") {
            setIsAuthenticated(true);
        } else {
            showAlert("Incorrect password.");
        }
    };

    const fetchGames = useCallback(async () => {
        try {
            const gamesCollection = collection(db, "games");
            const gamesSnapshot = await getDocs(gamesCollection);
            const gamesList = gamesSnapshot.docs.map(doc => ({ ...doc.data(), gameId: doc.id } as GameState));
            setGames(gamesList);
        } catch (error) {
            console.error("Error fetching games:", error);
            showAlert("Could not fetch games. Check Firestore connection and rules.");
        }
    }, [showAlert]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchGames();
        }
    }, [isAuthenticated, fetchGames]);

    const wipeAllGames = async () => {
        if (window.confirm("Are you sure you want to delete ALL games? This action is irreversible.")) {
            try {
                const gamesCollection = collection(db, "games");
                const gamesSnapshot = await getDocs(gamesCollection);
                const batch = writeBatch(db);
                gamesSnapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                showAlert("All games have been wiped out.");
                fetchGames();
            } catch (error) {
                console.error("Error wiping games:", error);
                showAlert("Failed to wipe games.");
            }
        }
    };

    const forceEndGameByAdmin = async (roomId: RoomId) => {
        if (window.confirm(`Are you sure you want to end game ${roomId}? This cannot be undone.`)) {
            await updateDoc(doc(db, "games", roomId), {
                status: 'finished',
                winner: null,
                gameLog: arrayUnion('Game forcefully ended by Admin.')
            });
            fetchGames();
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="max-w-md mx-auto">
                <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                    <h2 className="text-2xl font-semibold mb-4">Admin Login</h2>
                    <input type="password" placeholder="Enter Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
                    <button onClick={handleAdminLogin} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Login</button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-6 text-center">Admin Dashboard</h1>
            <div className="flex justify-center gap-4 mb-6">
                <button onClick={fetchGames} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                    Refresh Games
                </button>
                <button onClick={wipeAllGames} className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded">
                    Wipe All Games
                </button>
                <button onClick={() => window.location.href = '/'} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded">
                    Back to Lobby
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {games.length > 0 ? games.map(game => (
                    <div key={game.gameId} className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-600">
                        <h3 className="text-lg font-bold truncate">Room ID: {game.gameId}</h3>
                        <p>Status: <span className={`font-semibold ${game.status === 'in-progress' ? 'text-green-400' : 'text-yellow-400'}`}>{game.status}</span></p>
                        <p>Players: {Object.keys(game.players || {}).length} / {game.settings?.maxPlayers || 'N/A'}</p>
                        {game.status !== 'finished' && (
                            <button onClick={() => forceEndGameByAdmin(game.gameId)} className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm">
                                Force End Game
                            </button>
                        )}
                    </div>
                )) : <p className="col-span-full text-center text-gray-400">No active games found.</p>}
            </div>
        </div>
    );
};


const App: FC = () => {
    const [page, setPage] = useState('lobby');
    const [roomId, setRoomId] = useState<RoomId | null>(null);
    const [playerId, setPlayerId] = useState<PlayerId>(() => localStorage.getItem("monopolyPlayerId") || `p_${Date.now()}`);
    const [user, setUser] = useState<User | null>(null);
    const [alertInfo, setAlertInfo] = useState<{ message: string; isVisible: boolean }>({ message: '', isVisible: false });

    const showAlert = (message: string) => {
        setAlertInfo({ message, isVisible: true });
    };

    useEffect(() => {
        const storedPlayerId = localStorage.getItem("monopolyPlayerId");
        if (storedPlayerId) {
            setPlayerId(storedPlayerId);
        }
    }, []);

    const handleLogin = (loggedInUser: User) => {
        setUser(loggedInUser);
        const newPlayerId = loggedInUser.uid;
        setPlayerId(newPlayerId);
        localStorage.setItem("monopolyPlayerId", newPlayerId);
    };

    const handleLogout = () => {
        setUser(null);
        const newPlayerId = `p_${Date.now()}`;
        setPlayerId(newPlayerId);
        localStorage.setItem("monopolyPlayerId", newPlayerId);
        setPage('lobby'); // Go back to lobby on logout
    };

    useEffect(() => {
        const path = window.location.pathname;
        if (path.startsWith('/game/')) {
            setRoomId(path.split('/game/')[1].toUpperCase());
            setPage('game');
        } else if (path === '/admin') {
            setPage('admin');
        } else if (path === '/settings') {
            setPage('settings');
        }
    }, []);

    const renderPage = () => {
        if (page === 'settings' && user) {
            return <Settings user={user} onLogout={handleLogout} onBack={() => setPage('lobby')} showAlert={showAlert} />;
        }

        switch (page) {
            case 'game':
                return roomId ? <GameRoom roomId={roomId} currentPlayerId={playerId} showAlert={showAlert} /> : <div>Invalid Game Room</div>;
            case 'admin':
                return <AdminDashboard showAlert={showAlert} />;
            default:
                return <Lobby currentPlayerId={playerId} user={user} showAlert={showAlert} />;
        }
    };

    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen p-5 font-sans">
             {alertInfo.isVisible && <AlertPopup message={alertInfo.message} onClose={() => setAlertInfo({ message: '', isVisible: false })} />}
            <div className="relative">
               {page !== 'game' && <Auth onLogin={handleLogin} onLogout={handleLogout} onSettingsClick={() => setPage('settings')} />}
               {page !== 'game' && <Leaderboard />}
            </div>
            {renderPage()}
        </div>
    );
};

export default App;