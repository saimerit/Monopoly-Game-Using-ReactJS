import React, { useState, useEffect, useCallback } from 'react';
import type { FC, ReactNode } from 'react';
import { db } from './firebase'; 
import { 
    doc, setDoc, updateDoc, onSnapshot, arrayUnion, deleteField, 
    runTransaction, collection, getDocs, increment, getDoc, deleteDoc, 
    Transaction, writeBatch
} from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";

// ==========================================================
// TYPE DEFINITIONS
// ==========================================================
type PlayerId = string;
type RoomId = string;
type PropertyId = string;

interface Player {
    id: PlayerId;
    name: string;
    money: number;
    position: number;
    color: string;
    cities: PropertyId[];
    airports: PropertyId[];
    harbours: PropertyId[];
    companies: PropertyId[];
    inJail: boolean;
    jailTurns: number;
    doublesCount: number;
    onVacation: boolean;
}

interface PropertyState {
    owner: PlayerId | null;
    houses: number;
    mortgaged: boolean;
}

type BoardState = Record<string, PropertyState>;

interface AuctionState {
    active: boolean;
    propertyId?: PropertyId;
    currentBid?: number;
    highestBidder?: PlayerId | null;
    bidCount?: number;
}

interface TradeState {
    active: boolean;
    fromPlayer?: PlayerId;
    toPlayer?: PlayerId;
    offer?: { money: number; properties: PropertyId[] };
    request?: { money: number; properties: PropertyId[] };
}

interface GameState {
    gameId: RoomId;
    hostId: PlayerId;
    status: 'waiting' | 'in-progress' | 'finished';
    board: BoardState;
    settings: {
        initialMoney: number;
        maxPlayers: number;
    };
    players: Record<PlayerId, Player>;
    turnOrder: PlayerId[];
    currentPlayerTurn: PlayerId;
    gameLog: string[];
    vacationPot: number;
    auction: AuctionState;
    trade: TradeState;
    winner?: PlayerId;
}

interface BaseSquare {
    name: string;
    type: string;
}

interface CitySquare extends BaseSquare {
    type: 'city';
    country: string;
    cost: number;
    rent: number[];
}

interface UtilitySquare extends BaseSquare {
    type: 'airport' | 'harbour' | 'company';
    cost: number;
}

interface TaxSquare extends BaseSquare {
    type: 'tax';
    amount: number;
}

type BoardSquare = BaseSquare | CitySquare | UtilitySquare | TaxSquare;

// ==========================================================
// CONSTANTS & HELPERS
// ==========================================================
const generateRoomId = (): string => Math.random().toString(36).substring(2, 8).toUpperCase();

const playerColors: string[] = ['#d9534f', '#5cb85c', '#0275d8', '#f0ad4e', '#5bc0de', '#9b59b6', '#34495e', '#e74c3c'];

const countryData: Record<string, { cities: number[]; houseCost: number }> = {
    "India":    { cities: [1, 3, 6],    houseCost: 50 },
    "China":    { cities: [8, 9, 11],   houseCost: 50 },
    "Japan":    { cities: [13, 15],     houseCost: 100 },
    "Germany":  { cities: [17, 18, 20], houseCost: 100 },
    "Russia":   { cities: [22, 24, 25], houseCost: 150 },
    "France":   { cities: [27, 29, 30, 51], houseCost: 150 },
    "UK":       { cities: [32, 33, 35, 52], houseCost: 200 },
    "Canada":   { cities: [37, 39],     houseCost: 200 },
    "Brazil":   { cities: [41, 43, 44], houseCost: 220 },
    "Australia":{ cities: [46, 48, 49], houseCost: 220 },
    "USA":      { cities: [53, 54, 55], houseCost: 250 },
};

const countryFlags: Record<string, ReactNode> = {
    "India": ( <svg viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="900" height="200" fill="#FF9933"/><rect y="200" width="900" height="200" fill="#FFFFFF"/><rect y="400" width="900" height="200" fill="#138808"/></svg> ),
    "China": ( <svg viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="900" height="600" fill="#EE1C25"/><path d="M150 120 l28.9 90.2h-75.8l58.8-69.1-22.9-81.1z" fill="#FFFF00" transform="scale(1.5) translate(-40 -30)"/></svg> ),
    "Japan": ( <svg viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="900" height="600" fill="#FFFFFF"/><circle cx="450" cy="300" r="180" fill="#BC002D"/></svg> ),
    "Germany": ( <svg viewBox="0 0 5 3" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="5" height="1" fill="#000000"/><rect y="1" width="5" height="1" fill="#DD0000"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg> ),
    "Russia": ( <svg viewBox="0 0 9 6" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="9" height="2" fill="#FFFFFF"/><rect y="2" width="9" height="2" fill="#0039A6"/><rect y="4" width="9" height="2" fill="#D52B1E"/></svg> ),
    "France": ( <svg viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="300" height="600" fill="#002395"/><rect x="300" width="300" height="600" fill="#FFFFFF"/><rect x="600" width="300" height="600" fill="#ED2939"/></svg> ),
    "UK": ( <svg viewBox="0 0 2 1" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><path d="M0,0 H2 V1 H0z" fill="#00247d"/><path d="M1,.5 L0,0 M1,.5 L2,0 M1,.5 L0,1 M1,.5 L2,1" stroke="#fff" strokeWidth=".3"/><path d="M.85,.5 L0,0 M1.15,.5 L2,0 M.85,.5 L0,1 M1.15,.5 L2,1" stroke="#cf142b" strokeWidth=".2"/><path d="M0,.5 H2 M1,0 V1" stroke="#fff" strokeWidth=".5"/><path d="M0,.5 H2 M1,0 V1" stroke="#cf142b" strokeWidth=".3"/></svg> ),
    "Canada": ( <svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="300" height="150" fill="#FFFFFF"/><rect width="75" height="150" fill="#FF0000"/><rect x="225" width="75" height="150" fill="#FF0000"/><path d="M150 90 L130 75 L140 70 L120 60 L130 55 L110 45 L130 40 L140 20 L150 35 L160 20 L170 40 L190 45 L170 55 L180 60 L160 70 L170 75z" fill="#FF0000"/></svg> ),
    "Brazil": ( <svg viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="1000" height="700" fill="#009B3A"/><path d="M500 80 L880 350 L500 620 L120 350z" fill="#FFCC29"/><circle cx="500" cy="350" r="175" fill="#002776"/></svg> ),
    "Australia": ( <svg viewBox="0 0 12 6" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="12" height="6" fill="#00008B"/><path d="M0,0 L6,3 M6,0 L0,3" stroke="#FFFFFF" strokeWidth="1.2"/><path d="M0,0 L6,3 M6,0 L0,3" stroke="#FF0000" strokeWidth="0.8"/><path d="M3,0 V3 M0,1.5 H6" stroke="#FFFFFF" strokeWidth="2"/><path d="M3,0 V3 M0,1.5 H6" stroke="#FF0000" strokeWidth="1.2"/></svg> ),
    "USA": ( <svg viewBox="0 0 19 10" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><rect width="19" height="10" fill="#B22234"/><rect y="1" width="19" height="1" fill="#FFFFFF"/><rect y="3" width="19" height="1" fill="#FFFFFF"/><rect y="5" width="19" height="1" fill="#FFFFFF"/><rect y="7" width="19" height="1" fill="#FFFFFF"/><rect y="9" width="19" height="1" fill="#FFFFFF"/><rect width="9.5" height="5" fill="#3C3B6E"/></svg> ),
};

const initialBoardState: Record<string, BoardSquare> = {
    0: { name: "GO", type: "go" },
    1: { name: "Mumbai", type: "city", country: "India", cost: 60, rent: [2, 10, 30, 90, 160, 250] },
    2: { name: "Treasure Chest", type: "treasure" },
    3: { name: "Delhi", type: "city", country: "India", cost: 60, rent: [4, 20, 60, 180, 320, 450] },
    4: { name: "Income Tax", type: "tax", amount: 0.10 },
    5: { name: "Airport 1", type: "airport", cost: 200 },
    6: { name: "Hyderabad", type: "city", country: "India", cost: 100, rent: [6, 30, 90, 270, 400, 550] },
    7: { name: "Surprise", type: "surprise" },
    8: { name: "Beijing", type: "city", country: "China", cost: 100, rent: [6, 30, 90, 270, 400, 550] },
    9: { name: "Shanghai", type: "city", country: "China", cost: 120, rent: [8, 40, 100, 300, 450, 600] },
    10: { name: "Harbour 1", type: "harbour", cost: 150 },
    11: { name: "Shenzhen", type: "city", country: "China", cost: 140, rent: [10, 50, 150, 450, 625, 750] },
    12: { name: "Tech Corp", type: "company", cost: 150 },
    13: { name: "Tokyo", type: "city", country: "Japan", cost: 140, rent: [10, 50, 150, 450, 625, 750] },
    14: { name: "Jail / Visiting", type: "jail" },
    15: { name: "Osaka", type: "city", country: "Japan", cost: 160, rent: [12, 60, 180, 500, 700, 900] },
    16: { name: "Airport 2", type: "airport", cost: 200 },
    17: { name: "Berlin", type: "city", country: "Germany", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    18: { name: "Munich", type: "city", country: "Germany", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    19: { name: "Treasure Chest", type: "treasure" },
    20: { name: "Hamburg", type: "city", country: "Germany", cost: 200, rent: [16, 80, 220, 600, 800, 1000] },
    21: { name: "Harbour 2", type: "harbour", cost: 150 },
    22: { name: "Moscow", type: "city", country: "Russia", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    23: { name: "Surprise", type: "surprise" },
    24: { name: "St. Petersburg", type: "city", country: "Russia", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    25: { name: "Kazan", type: "city", country: "Russia", cost: 240, rent: [20, 100, 300, 750, 925, 1100] },
    26: { name: "Energy Corp", type: "company", cost: 150 },
    27: { name: "Paris", type: "city", country: "France", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    28: { name: "Vacation", type: "vacation" },
    29: { name: "Marseille", type: "city", country: "France", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    30: { name: "Lyon", type: "city", country: "France", cost: 280, rent: [24, 120, 360, 850, 1025, 1200] },
    31: { name: "Airport 3", type: "airport", cost: 200 },
    32: { name: "London", type: "city", country: "UK", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    33: { name: "Manchester", type: "city", country: "UK", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    34: { name: "Treasure Chest", type: "treasure" },
    35: { name: "Liverpool", type: "city", country: "UK", cost: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
    36: { name: "Harbour 3", type: "harbour", cost: 150 },
    37: { name: "Toronto", type: "city", country: "Canada", cost: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    38: { name: "Surprise", type: "surprise" },
    39: { name: "Vancouver", type: "city", country: "Canada", cost: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
    40: { name: "Luxury Tax", type: "tax", amount: 100 },
    41: { name: "Rio de Janeiro", type: "city", country: "Brazil", cost: 420, rent: [60, 220, 650, 1500, 1800, 2100] },
    42: { name: "Go to Jail", type: "go-to-jail-square" },
    43: { name: "Sao Paulo", type: "city", country: "Brazil", cost: 420, rent: [60, 220, 650, 1500, 1800, 2100] },
    44: { name: "Brasilia", type: "city", country: "Brazil", cost: 450, rent: [70, 250, 700, 1600, 1900, 2200] },
    45: { name: "Airport 4", type: "airport", cost: 200 },
    46: { name: "Sydney", type: "city", country: "Australia", cost: 475, rent: [80, 280, 750, 1700, 2000, 2400] },
    47: { name: "Treasure Chest", type: "treasure" },
    48: { name: "Melbourne", type: "city", country: "Australia", cost: 475, rent: [80, 280, 750, 1700, 2000, 2400] },
    49: { name: "Canberra", type: "city", country: "Australia", cost: 500, rent: [90, 300, 800, 1800, 2100, 2500] },
    50: { name: "Harbour 4", type: "harbour", cost: 150 },
    51: { name: "Nice", type: "city", country: "France", cost: 525, rent: [100, 320, 850, 1900, 2200, 2600] },
    52: { name: "Glasgow", type: "city", country: "UK", cost: 525, rent: [100, 320, 850, 1900, 2200, 2600] },
    53: { name: "New York", type: "city", country: "USA", cost: 550, rent: [110, 350, 900, 2000, 2400, 2800] },
    54: { name: "Los Angeles", type: "city", country: "USA", cost: 550, rent: [110, 350, 900, 2000, 2400, 2800] },
    55: { name: "Chicago", type: "city", country: "USA", cost: 600, rent: [120, 400, 1000, 2200, 2600, 3000] },
};

const getInitialDynamicBoardState = (): BoardState => {
    const board: BoardState = {};
    for (const pos in initialBoardState) {
        const square = initialBoardState[pos];
        if (['city', 'airport', 'harbour', 'company'].includes(square.type)) {
            board[pos] = { owner: null, houses: 0, mortgaged: false };
        }
    }
    return board;
};

// ==========================================================
// CORE GAME LOGIC FUNCTIONS
// ==========================================================
const handleBankruptcy = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);

    const playerIds = Object.keys(gameState.players);
    if (playerIds.length === 1 && playerIds[0] === playerId) {
        await updateDoc(gameRef, {
            status: 'finished',
            winner: playerId,
            gameLog: arrayUnion(`${player.name} is the last one standing and wins the game!`)
        });
        return;
    }

    const updates: DocumentData = {};
    updates[`players.${playerId}`] = deleteField();
    for (const pos in gameState.board) {
        if (gameState.board[pos].owner === playerId) {
            updates[`board.${pos}.owner`] = null;
            updates[`board.${pos}.houses`] = 0;
            updates[`board.${pos}.mortgaged`] = false;
        }
    }
    updates.gameLog = arrayUnion(`${player.name} has declared bankruptcy!`);

    const remainingPlayerIds = Object.keys(gameState.players).filter(pId => pId !== playerId);
    if (remainingPlayerIds.length === 1) {
        const winnerId = remainingPlayerIds[0];
        const winnerName = gameState.players[winnerId].name;
        updates.status = 'finished';
        updates.winner = winnerId;
        updates.gameLog = arrayUnion(`The game is over! ${winnerName} is the winner!`);
    }

    await updateDoc(gameRef, updates);
};

const handlePayment = async (roomId: RoomId, renterId: PlayerId, squarePosition: PropertyId, diceRoll: number, gameState: GameState) => {
    const squareInfo = initialBoardState[squarePosition] as CitySquare | UtilitySquare;
    const squareState = gameState.board[squarePosition];
    if (!squareState || !squareState.owner || squareState.owner === renterId || squareState.mortgaged) return;

    const renter = gameState.players[renterId];
    const owner = gameState.players[squareState.owner];
    let rentAmount = 0;

    switch (squareInfo.type) {
        case 'city': {
            const country = countryData[squareInfo.country];
            const ownerHasMonopoly = country.cities.every(cityId => owner.cities.includes(String(cityId)));
            rentAmount = ownerHasMonopoly ? (squareInfo.rent[squareState.houses] || 0) : (squareInfo.rent[0] || 0);
            break;
        }
        case 'airport': {
            const airportsOwned = owner.airports.length;
            rentAmount = 25 * (2 ** (airportsOwned - 1));
            break;
        }
        case 'harbour': {
            const harboursOwned = owner.harbours.length;
            rentAmount = 100 * harboursOwned;
            break;
        }
        case 'company': {
            const companiesOwned = owner.companies.length;
            const multiplier = companiesOwned === 1 ? 4 : 10;
            rentAmount = multiplier * diceRoll;
            break;
        }
        default: return;
    }

    if (renter.money < rentAmount) {
        await handleBankruptcy(roomId, renterId, gameState);
    } else {
        await updateDoc(doc(db, "games", roomId), {
            [`players.${renterId}.money`]: increment(-rentAmount),
            [`players.${owner.id}.money`]: increment(rentAmount),
            gameLog: arrayUnion(`${renter.name} paid $${rentAmount} to ${owner.name}.`)
        });
    }
};

const startAuction = async (roomId: RoomId, propertyId: PropertyId) => {
    const property = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    await updateDoc(doc(db, "games", roomId), {
        auction: {
            active: true,
            propertyId: propertyId,
            currentBid: Math.floor(property.cost / 2),
            highestBidder: null,
            bidCount: 0,
        },
        gameLog: arrayUnion(`Auction started for ${property.name}!`)
    });
};

const handleLandingOnSquare = async (roomId: RoomId, playerId: PlayerId, newPosition: number, diceRoll: number, gameState: GameState) => {
    const square = initialBoardState[newPosition];
    if (!square) return;

    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);

    await updateDoc(gameRef, {
        gameLog: arrayUnion(`${player.name} landed on ${square.name}.`)
    });

    switch (square.type) {
        case 'city':
        case 'airport':
        case 'harbour':
        case 'company':
            if (gameState.board[newPosition].owner) {
                await handlePayment(roomId, playerId, String(newPosition), diceRoll, gameState);
            }
            break;
        case 'tax': {
            const taxSquare = square as TaxSquare;
            const taxAmount = taxSquare.amount < 1 ? Math.floor(player.money * taxSquare.amount) : taxSquare.amount;
            await updateDoc(gameRef, {
                [`players.${playerId}.money`]: increment(-taxAmount),
                vacationPot: increment(taxAmount),
                gameLog: arrayUnion(`${player.name} paid $${taxAmount} in tax.`)
            });
            break;
        }
        case 'vacation': {
            const pot = gameState.vacationPot || 0;
            await updateDoc(gameRef, {
                [`players.${playerId}.money`]: increment(pot),
                [`players.${playerId}.onVacation`]: true,
                vacationPot: 0,
                gameLog: arrayUnion(`${player.name} collected $${pot} from the vacation pot! They will skip their next turn.`)
            });
            break;
        }
        case 'go-to-jail-square':
            await goToJail(roomId, playerId, gameState);
            break;
    }
};

const goToJail = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.position`]: 14,
        [`players.${playerId}.inJail`]: true,
        [`players.${playerId}.jailTurns`]: 0,
        [`players.${playerId}.doublesCount`]: 0,
        gameLog: arrayUnion(`${gameState.players[playerId].name} was sent to Jail!`)
    });
};

const buyProperty = async (roomId: RoomId, playerId: PlayerId, propertyPosition: number, gameState: GameState) => {
    const player = gameState.players[playerId];
    const property = initialBoardState[propertyPosition] as CitySquare | UtilitySquare;
    if (player.money < property.cost) {
        alert("Not enough money!");
        return;
    }

    const propertyTypeMap: Record<string, keyof Player> = { 'city': 'cities', 'airport': 'airports', 'harbour': 'harbours', 'company': 'companies' };
    const ownershipArray = propertyTypeMap[property.type];

    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(-property.cost),
        [`players.${playerId}.${ownershipArray}`]: arrayUnion(String(propertyPosition)),
        [`board.${propertyPosition}.owner`]: playerId,
        gameLog: arrayUnion(`${player.name} bought ${property.name} for $${property.cost}.`)
    });
};

const mortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
    const propertyInfo = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    const propertyState = gameState.board[propertyId];
    const player = gameState.players[playerId];

    if (propertyState.houses > 0) {
        alert("You must sell all houses before mortgaging.");
        return;
    }
    if (propertyState.mortgaged) {
        alert("This property is already mortgaged.");
        return;
    }

    const mortgageValue = propertyInfo.cost / 2;
    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(mortgageValue),
        [`board.${propertyId}.mortgaged`]: true,
        gameLog: arrayUnion(`${player.name} mortgaged ${propertyInfo.name} for $${mortgageValue}.`)
    });
};

const unmortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
    const propertyInfo = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    const player = gameState.players[playerId];
    const unmortgageCost = (propertyInfo.cost / 2) * 1.1;

    if (player.money < unmortgageCost) {
        alert(`You need $${Math.ceil(unmortgageCost)} to unmortgage.`);
        return;
    }

    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(-unmortgageCost),
        [`board.${propertyId}.mortgaged`]: false,
        gameLog: arrayUnion(`${player.name} unmortgaged ${propertyInfo.name}.`)
    });
};

const buildHouse = async (roomId: RoomId, playerId: PlayerId, cityId: PropertyId, gameState: GameState) => {
    const player = gameState.players[playerId];
    const cityInfo = initialBoardState[cityId] as CitySquare;
    const countryInfo = countryData[cityInfo.country];
    const cityState = gameState.board[cityId];

    const hasMonopoly = countryInfo.cities.every(cId => player.cities.includes(String(cId)));
    if (!hasMonopoly) {
        alert("You need to own all cities in a country to build houses.");
        return;
    }
    if (player.money < countryInfo.houseCost) {
        alert(`You need $${countryInfo.houseCost} to build a house.`);
        return;
    }

    const housesInCountry = countryInfo.cities.map(cId => gameState.board[cId].houses);
    const minHouses = Math.min(...housesInCountry);
    if (cityState.houses > minHouses) {
        alert(`You must build evenly. Build on another city in ${cityInfo.country} first.`);
        return;
    }

    if (cityState.houses >= 5) {
        alert("You cannot build any more on this property.");
        return;
    }

    const houseOrHotel = cityState.houses === 4 ? "a hotel" : "a house";
    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(-countryInfo.houseCost),
        [`board.${cityId}.houses`]: increment(1),
        gameLog: arrayUnion(`${player.name} built ${houseOrHotel} in ${cityInfo.name}.`)
    });
};

const handleDeleteGame = async (roomId: RoomId) => {
    if (window.confirm("Are you sure you want to delete this game? This action cannot be undone.")) {
        await deleteDoc(doc(db, "games", roomId));
    }
};

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


// ==========================================================
// REACT COMPONENTS
// ==========================================================
const App: FC = () => {
    const [page, setPage] = useState('lobby');
    const [roomId, setRoomId] = useState<RoomId | null>(null);
    const [playerId] = useState<PlayerId>(() => localStorage.getItem("monopolyPlayerId") || `p_${Date.now()}`);

    useEffect(() => {
        localStorage.setItem("monopolyPlayerId", playerId);
        const path = window.location.pathname;
        if (path.startsWith('/game/')) {
            setRoomId(path.split('/game/')[1].toUpperCase());
            setPage('game');
        } else if (path === '/admin') {
            setPage('admin');
        }
    }, [playerId]);

    const renderPage = () => {
        switch (page) {
            case 'game':
                return roomId ? <GameRoom roomId={roomId} currentPlayerId={playerId} /> : <div>Invalid Game Room</div>;
            case 'admin':
                return <AdminDashboard />;
            default:
                return <Lobby currentPlayerId={playerId} />;
        }
    };

    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen p-5 font-sans">
            {renderPage()}
        </div>
    );
};

interface LobbyProps {
    currentPlayerId: PlayerId;
}

const Lobby: FC<LobbyProps> = ({ currentPlayerId }) => {
    const [playerName, setPlayerName] = useState("");
    const [joinRoomId, setJoinRoomId] = useState("");
    const [initialMoney, setInitialMoney] = useState(500);
    const maxPlayers = 8;

    const handleCreateGame = async () => {
        if (!playerName) return alert("Please enter your name.");
        
        let newRoomId: RoomId;
        let gameRef;
        let docSnap;

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
            settings: { initialMoney: Number(initialMoney), maxPlayers: maxPlayers },
            players: {
                [currentPlayerId]: { id: currentPlayerId, name: playerName, money: Number(initialMoney), position: 0, cities: [], airports: [], harbours: [], companies: [], inJail: false, jailTurns: 0, doublesCount: 0, onVacation: false, color: playerColors[0] }
            },
            turnOrder: [currentPlayerId],
            currentPlayerTurn: currentPlayerId,
            gameLog: [`Game created by ${playerName}.`],
            vacationPot: 0,
            auction: { active: false },
            trade: { active: false }
        };
        try {
            await setDoc(gameRef, newGame);
            window.location.href = `/game/${newRoomId}`;
        } catch (error) {
            console.error("Failed to create game:", error);
            alert("Could not create the game. Please check your connection and Firestore rules.");
        }
    };

    const handleJoinGame = async () => {
        if (!playerName || !joinRoomId) return alert("Please enter name and room ID.");
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
                    [`players.${currentPlayerId}`]: { id: currentPlayerId, name: playerName, money: gameData.settings.initialMoney, position: 0, cities: [], airports: [], harbours: [], companies: [], inJail: false, jailTurns: 0, doublesCount: 0, onVacation: false, color: newPlayerColor },
                    turnOrder: arrayUnion(currentPlayerId),
                    gameLog: arrayUnion(`${playerName} joined the game.`)
                });
            });
            window.location.href = `/game/${joinRoomId.toUpperCase()}`;
        } catch (error) {
            console.error(error);
            if (error instanceof Error) {
                alert(error.message);
            } else {
                alert("An unknown error occurred.");
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
                        <label className="block mb-2">Initial Money:</label>
                        <select value={initialMoney} onChange={(e) => setInitialMoney(Number(e.target.value))} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white">
                            <option value="300">$300</option>
                            <option value="500">$500</option>
                            <option value="800">$800</option>
                            <option value="1000">$1000</option>
                        </select>
                        <p className="mb-4">Max Players: 8</p> 
                        <button onClick={handleCreateGame} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-200">Create Game</button>
                    </div>
                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                        <h2 className="text-2xl font-semibold mb-4">Join an Existing Game</h2>
                        <input type="text" placeholder="Enter Your Name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
                        <input type="text" placeholder="Enter 6-Digit Room ID" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white" />
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
}

const AuctionModal: FC<ModalProps> = ({ gameState, roomId, currentPlayerId }) => {
    const [timer, setTimer] = useState(5);
    const { auction } = gameState;
    const property = auction.propertyId ? initialBoardState[auction.propertyId] as CitySquare | UtilitySquare : null;
    const me = gameState.players[currentPlayerId];

    const endAuction = useCallback(async () => {
        if (!property) return;
        const { highestBidder, currentBid, propertyId } = auction;
        const updates: DocumentData = { "auction.active": false };
        if (highestBidder && currentBid && propertyId) {
            const winner = gameState.players[highestBidder];
            const propertyTypeMap: Record<string, keyof Player> = { 'city': 'cities', 'airport': 'airports', 'harbour': 'harbours', 'company': 'companies' };
            const ownershipArray = propertyTypeMap[property.type];
            updates[`players.${highestBidder}.money`] = increment(-currentBid);
            updates[`players.${highestBidder}.${ownershipArray}`] = arrayUnion(String(propertyId));
            updates[`board.${propertyId}.owner`] = highestBidder;
            updates.gameLog = arrayUnion(`${winner.name} won the auction for ${property.name} with a bid of $${currentBid}!`);
        } else {
            updates.gameLog = arrayUnion(`Auction for ${property.name} ended with no bids.`);
        }
        await updateDoc(doc(db, "games", roomId), updates);
    }, [auction, gameState.players, roomId, property]);

    useEffect(() => {
        setTimer(5);
    }, [auction.bidCount]);

    useEffect(() => {
        if (!auction.active) return;
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
    }, [auction.active, auction.bidCount, gameState.hostId, currentPlayerId, endAuction]);
    
    if (!property) return null;

    const placeBid = async (amount: number) => {
        if (!auction.currentBid) return;
        const newBid = auction.currentBid + amount;
        if (me.money < newBid) return alert("You cannot afford this bid.");
        await updateDoc(doc(db, "games", roomId), {
            "auction.currentBid": newBid,
            "auction.highestBidder": currentPlayerId,
            "auction.bidCount": increment(1),
            gameLog: arrayUnion(`${me.name} bid $${newBid}.`)
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 text-center shadow-xl w-96">
                <h2 className="text-2xl font-bold mb-2">Auction for {property.name}</h2>
                <h3 className="text-xl mb-2">Current Bid: ${auction.currentBid}</h3>
                <p className="mb-4">Highest Bidder: {gameState.players[auction.highestBidder || '']?.name || 'None'}</p>
                <h3 className="text-3xl font-mono mb-4">Selling in: {timer}</h3>
                <div className="flex justify-center gap-4">
                    <button onClick={() => placeBid(10)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">+$10</button>
                    <button onClick={() => placeBid(50)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">+$50</button>
                    <button onClick={() => placeBid(100)} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded">+$100</button>
                </div>
            </div>
        </div>
    );
};

interface TradeModalProps extends ModalProps {
    setShowTradeModal: (show: boolean) => void;
}

function TradeModal({ gameState, roomId, currentPlayerId, setShowTradeModal }: TradeModalProps) {
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
        if (!tradePartnerId) return alert("Please select a player to trade with.");
        await updateDoc(doc(db, "games", roomId), {
            trade: {
                active: true,
                fromPlayer: currentPlayerId,
                toPlayer: tradePartnerId,
                offer,
                request
            },
            gameLog: arrayUnion(`${me.name} sent a trade offer to ${tradePartner.name}.`)
        });
        setShowTradeModal(false);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 shadow-xl w-full max-w-3xl">
                <h2 className="text-2xl font-bold mb-4 text-center">Propose a Trade</h2>
                <select onChange={(e) => setTradePartnerId(e.target.value)} value={tradePartnerId} className="w-full p-2 mb-4 bg-gray-700 border border-gray-500 rounded text-white">
                    <option value="">Select a player...</option>
                    {Object.values(gameState.players).filter(p => p.id !== currentPlayerId).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>

                {tradePartner && (
                    <div className="flex gap-6">
                        {/* Your Offer Column */}
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
                                        }}/> <span>{initialBoardState[propId].name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        {/* Their Request Column */}
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
                                        }}/> <span>{initialBoardState[propId].name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                
                <div className="flex justify-center gap-4 mt-6">
                    <button onClick={handleSendOffer} disabled={!tradePartnerId} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded disabled:bg-gray-500">Send Offer</button>
                    <button onClick={() => setShowTradeModal(false)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded">Cancel</button>
                </div>
            </div>
        </div>
    );
}

interface BoardProps {
    players: Record<PlayerId, Player>;
    boardState: BoardState;
    gameLog: string[];
}

const Board: FC<BoardProps> = ({ players, boardState, gameLog }) => {
    const getGridPosition = (i: number): { gridArea: string } => {
        let row, col;
        if (i >= 0 && i <= 14) { row = 15; col = 15 - i; } 
        else if (i >= 15 && i <= 28) { row = 15 - (i - 14); col = 1; } 
        else if (i >= 29 && i <= 42) { row = 1; col = 1 + (i - 28); } 
        else { row = 1 + (i - 42); col = 15; }
        return { gridArea: `${row} / ${col}` };
    };

    const cells = Array.from({ length: 56 }, (_, i) => {
        const cellInfo = initialBoardState[i];
        const cellState = boardState[i];
        const isCorner = [0, 14, 28, 42].includes(i);
        const hasColorBar = cellInfo.type === 'city';
        const flagSvg = hasColorBar ? countryFlags[(cellInfo as CitySquare).country] : null;
        const ownerColor = cellState?.owner ? players[cellState.owner]?.color : null;
        
        const isLeftSide = i >= 15 && i <= 27;
        const isRightSide = i >= 43 && i <= 55;
        
        const wrapperStyle: React.CSSProperties = {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            height: '100%',
            position: 'relative',
        };

        if (isLeftSide) {
            wrapperStyle.transform = 'rotate(90deg)';
            wrapperStyle.width = '60px';
            wrapperStyle.height = '100px';
        }
        if (isRightSide) {
            wrapperStyle.transform = 'rotate(-90deg)';
            wrapperStyle.width = '60px';
            wrapperStyle.height = '100px';
        }

        if (cellInfo.type === 'jail') {
            return (
                <div key={i} className="bg-gray-700 border border-gray-500 relative flex justify-center items-center text-xs text-center font-bold text-sm" style={getGridPosition(i)}>
                    <div className="w-full h-full relative">
                        <div className="absolute bottom-1 left-1 text-[10px] font-bold">Just Visiting</div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-0.5 w-12 justify-center">
                            {Object.values(players).map(p => 
                                p.position === i && !p.inJail && <div key={p.id} className="w-4 h-4 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                            )}
                        </div>
                    </div>
                    <div className="absolute top-1 right-1 w-3/5 h-3/5 bg-red-800 bg-opacity-50 text-white flex justify-center items-center text-xs font-bold border border-red-500">
                        IN JAIL
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-0.5 w-12 justify-center">
                            {Object.values(players).map(p => 
                                p.position === i && p.inJail && <div key={p.id} className="w-4 h-4 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div key={i} className={`bg-gray-700 border border-gray-500 relative flex justify-center items-center text-[9px] text-center box-border ${isCorner ? 'font-bold text-sm' : ''}`} style={getGridPosition(i)}>
                <div className="content-wrapper" style={wrapperStyle}>
                    {hasColorBar && <div className="w-full h-5 border-b border-gray-500 overflow-hidden">{flagSvg}</div>}
                    <div className="p-0.5 flex-grow flex items-center justify-center">{cellInfo.name}</div>
                    
                    {!cellState?.owner && (cellInfo as UtilitySquare).cost && <div className="text-xs font-bold pb-1">${(cellInfo as UtilitySquare).cost}</div>}
                    
                    {ownerColor && <div className="w-full h-5 border-t border-gray-500" style={{ backgroundColor: ownerColor }}></div>}
                </div>
                {cellState?.mortgaged && <div className="absolute text-5xl text-red-500 text-opacity-70 font-bold">💲</div>}
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-0.5 w-12 justify-center">
                    {Object.values(players).map(p => 
                        p.position === i && <div key={p.id} className="w-4 h-4 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                    )}
                </div>
            </div>
        );
    });

    return (
        <div className="flex justify-center items-center p-5">
            <div className="grid grid-cols-[100px_repeat(13,_60px)_100px] grid-rows-[100px_repeat(13,_60px)_100px] gap-0.5 bg-black border-2 border-gray-500 relative">
                {cells}
                <div className="col-start-2 col-span-13 row-start-2 row-span-13 bg-[#2a3d2b] p-4 box-border">
                    <div className="h-full overflow-y-auto p-2.5 bg-green-900 bg-opacity-50 rounded text-gray-100">
                       {gameLog.slice().reverse().map((msg, i) => <p key={i} className="m-0 mb-1.5 pb-1.5 border-b border-dotted border-gray-500 text-base">{msg}</p>)}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface GameRoomProps {
    roomId: RoomId;
    currentPlayerId: PlayerId;
}

const GameRoom: FC<GameRoomProps> = ({ roomId, currentPlayerId }) => {
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [showTradeModal, setShowTradeModal] = useState(false);
    const [lastProcessedLog, setLastProcessedLog] = useState("");
    const [hasRolled, setHasRolled] = useState(false);

    useEffect(() => {
        const gameRef = doc(db, "games", roomId);
        const unsubscribe = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                setGameState(docSnap.data() as GameState);
            } else {
                alert("Game room not found!");
                window.location.href = '/';
            }
        });
        return () => unsubscribe();
    }, [roomId]);

    useEffect(() => {
        if (!gameState || gameState.status !== 'in-progress' || !gameState.gameLog.length) return;

        const lastLog = gameState.gameLog[gameState.gameLog.length - 1];
        if (lastLog && lastLog !== lastProcessedLog && lastLog.includes(" landed on ")) {
            setLastProcessedLog(lastLog);
            
            const actingPlayerId = gameState.currentPlayerTurn;
            const actingPlayer = gameState.players[actingPlayerId];
            const match = lastLog.match(/rolled a (\d+)/);
            const diceRoll = match ? parseInt(match[1], 10) : 0;

            handleLandingOnSquare(roomId, actingPlayerId, actingPlayer.position, diceRoll, gameState);
        }
    }, [gameState, roomId, lastProcessedLog]);
    
    useEffect(() => {
        setHasRolled(false);
    }, [gameState?.currentPlayerTurn]);

    const handleStartGame = async () => {
        if (!gameState || gameState.hostId !== currentPlayerId) return alert("Only the admin can start the game.");
        
        const shuffledTurnOrder = [...gameState.turnOrder].sort(() => Math.random() - 0.5);

        await updateDoc(doc(db, "games", roomId), { 
            status: "in-progress",
            turnOrder: shuffledTurnOrder,
            currentPlayerTurn: shuffledTurnOrder[0],
            gameLog: arrayUnion("The game has started! Turn order is randomized.")
        });
    };

    const handleRollDice = async () => {
        if (!gameState || gameState.currentPlayerTurn !== currentPlayerId) return alert("It's not your turn!");
        const player = gameState.players[currentPlayerId];

        if (player.onVacation) {
            alert("You are on vacation and must skip this turn. Click 'End Turn' to proceed.");
            return;
        }

        let doublesCount = player.doublesCount || 0;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const diceRoll = die1 + die2;
        const isDoubles = die1 === die2;

        if (isDoubles) doublesCount++;
        else doublesCount = 0;

        if (doublesCount === 3) {
            await goToJail(roomId, currentPlayerId, gameState);
            await handleEndTurn();
            return;
        }

        const newPosition = (player.position + diceRoll) % 56;
        const updates: DocumentData = {
            [`players.${currentPlayerId}.position`]: newPosition,
            [`players.${currentPlayerId}.doublesCount`]: doublesCount,
        };
        
        const logMessages = [`${player.name} rolled a ${diceRoll}${isDoubles ? ' (doubles!)' : ''}.`];

        if (newPosition < player.position && !player.inJail) {
            const amount = 200;
            updates[`players.${currentPlayerId}.money`] = increment(amount);
            logMessages.push(`${player.name} passed GO and collected $${amount}.`);
        }
        
        updates.gameLog = arrayUnion(...logMessages);

        await updateDoc(doc(db, "games", roomId), updates);

        if (!isDoubles) {
            setHasRolled(true);
        }
    };

    const handleEndTurn = async () => {
        if (!gameState) return;
        const { turnOrder, currentPlayerTurn } = gameState;
        const player = gameState.players[currentPlayerTurn];
        const currentIndex = turnOrder.indexOf(currentPlayerTurn);
        const nextPlayerId = turnOrder[(currentIndex + 1) % turnOrder.length];
        
        const updates: DocumentData = {
            [`players.${currentPlayerTurn}.doublesCount`]: 0,
            currentPlayerTurn: nextPlayerId,
            gameLog: arrayUnion(`${player.name}'s turn ended.`)
        };

        if (player.onVacation) {
            updates[`players.${currentPlayerTurn}.onVacation`] = false;
        }
        
        await updateDoc(doc(db, "games", roomId), updates);
    };
    
    if (!gameState) return <div className="text-center text-xl">Loading Game...</div>;

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
    
    const me = gameState.players[currentPlayerId];
    if (!me) {
        return (
            <div className="max-w-4xl mx-auto text-center">
                <h1 className="text-4xl font-bold mb-4">You have been eliminated!</h1>
                <p className="text-lg mb-8">Thanks for playing.</p>
                <a href="/" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Back to Lobby</a>
            </div>
        );
    }

    const currentSquareInfo = initialBoardState[me.position];
    const currentSquareState = gameState.board[me.position];
    const canBuy = ['city', 'airport', 'harbour', 'company'].includes(currentSquareInfo?.type) && !currentSquareState?.owner;
    const amIOnTurn = gameState.currentPlayerTurn === currentPlayerId;
    const myProperties = [...me.cities, ...me.airports, ...me.harbours, ...me.companies];

    return (
        <div className="max-w-[1500px] mx-auto">
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <Board players={gameState.players} boardState={gameState.board} gameLog={gameState.gameLog} />
                <div className="flex-shrink-0 w-full lg:w-96 bg-gray-800 p-4 rounded-lg border border-gray-600 shadow-lg">
                    <h1 className="text-2xl font-bold mb-2">Room: {roomId}</h1>
                    <div className="bg-gray-700 p-2.5 rounded mb-4">
                        <p><strong>Admin:</strong> {gameState.players[gameState.hostId]?.name || 'N/A'}</p>
                        <p><strong>Initial Money:</strong> ${gameState.settings.initialMoney}</p>
                        <p><strong>Vacation Pot:</strong> ${gameState.vacationPot || 0}</p>
                    </div>

                    {gameState.status === "waiting" && currentPlayerId === gameState.hostId && (
                        <div className="flex gap-2 mb-4">
                            <button onClick={handleStartGame} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">Start Game</button>
                            <button onClick={() => handleDeleteGame(roomId)} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">Delete Game</button>
                        </div>
                    )}
                    
                    <h2 className="text-xl font-semibold mb-2">Players</h2>
                    <div className="space-y-2.5 mb-4">
                        {Object.values(gameState.players).map(p => (
                            <div key={p.id} className={`flex items-center border border-gray-700 p-2.5 rounded-md transition-all duration-200 ${p.id === gameState.currentPlayerTurn ? 'border-l-4 border-green-500 shadow-lg bg-gray-700' : ''}`}>
                                <div className="w-4 h-4 rounded-full mr-2.5" style={{backgroundColor: p.color}}></div>
                                <div>
                                    <strong>{p.name} {p.id === currentPlayerId ? '(You)' : ''}</strong>
                                    <p className="text-sm">Money: ${p.money}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <h2 className="text-xl font-semibold mb-2">Your Turn</h2>
                    {amIOnTurn && gameState.status === 'in-progress' && (
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {!hasRolled && !me.onVacation && (
                            <button onClick={handleRollDice} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Roll Dice</button>
                        )}
                         {me.doublesCount > 0 && !hasRolled && <p className="text-green-400 col-span-2 text-center">You rolled doubles! Roll again.</p>}

                        {(hasRolled || me.onVacation) && (
                            <>
                                {canBuy && <button onClick={() => buyProperty(roomId, currentPlayerId, me.position, gameState)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">Buy ({currentSquareInfo.name})</button>}
                                {canBuy && <button onClick={() => startAuction(roomId, String(me.position))} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded">Auction</button>}
                                <button onClick={handleEndTurn} className="col-span-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">End Turn</button>
                            </>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        <button onClick={() => handleBankruptcy(roomId, currentPlayerId, gameState)} className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded">Declare Bankruptcy</button>
                        <button onClick={() => setShowTradeModal(true)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded">Propose Trade</button>
                    </div>
                    
                    <div>
                        <h2 className="text-xl font-semibold mb-2">Your Properties</h2>
                        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-2">
                            {myProperties.length > 0 ? myProperties.map(propId => {
                                const propInfo = initialBoardState[propId] as CitySquare | UtilitySquare;
                                const propState = gameState.board[propId];
                                const countryInfo = propInfo.type === 'city' ? countryData[propInfo.country] : null;
                                const hasMonopoly = countryInfo && countryInfo.cities.every(cId => me.cities.includes(String(cId)));
                                
                                return (
                                    <div key={propId} className={`p-2 rounded-md border ${propState.mortgaged ? 'bg-red-900 bg-opacity-50 border-red-700' : 'bg-gray-700 border-gray-600'}`}>
                                        <strong>{propInfo.name}</strong>
                                        {propInfo.type === 'city' && <p className="text-xs">Houses: {propState.houses < 5 ? '🏠'.repeat(propState.houses) : '🏨'}</p>}
                                        
                                        <div className="flex gap-1 mt-1">
                                            {propState.mortgaged ? (
                                                <button onClick={() => unmortgageProperty(roomId, currentPlayerId, propId, gameState)} className="text-xs flex-1 bg-green-600 hover:bg-green-700 py-1 px-2 rounded">
                                                    Unmortgage (${Math.ceil((propInfo.cost / 2) * 1.1)})
                                                </button>
                                            ) : (
                                                <button onClick={() => mortgageProperty(roomId, currentPlayerId, propId, gameState)} className="text-xs flex-1 bg-yellow-600 hover:bg-yellow-700 py-1 px-2 rounded">
                                                    Mortgage (${propInfo.cost / 2})
                                                </button>
                                            )}

                                            {hasMonopoly && !propState.mortgaged && propInfo.type === 'city' && (
                                                <button onClick={() => buildHouse(roomId, currentPlayerId, propId, gameState)} className="text-xs flex-1 bg-blue-500 hover:bg-blue-600 py-1 px-2 rounded">
                                                    Build (${countryInfo.houseCost})
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            }) : <p className="text-gray-400">You do not own any properties.</p>}
                        </div>
                    </div>
                </div>
            </div>
            {(showTradeModal || (gameState.trade?.active && gameState.trade?.toPlayer === currentPlayerId)) && <TradeModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} setShowTradeModal={setShowTradeModal} />}
            {gameState.auction?.active && <AuctionModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} />}
        </div>
    );
};

const AdminDashboard: FC = () => {
    const [games, setGames] = useState<GameState[]>([]);
    const [password, setPassword] = useState("");
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const handleAdminLogin = () => {
        if (password === "admin123") { // Replace with a more secure method in a real app
            setIsAuthenticated(true);
        } else {
            alert("Incorrect password.");
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
            alert("Could not fetch games. Check Firestore connection and rules.");
        }
    }, []);

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
                alert("All games have been wiped out.");
                fetchGames(); // Refresh the list
            } catch (error) {
                console.error("Error wiping games:", error);
                alert("Failed to wipe games.");
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

export default App;
