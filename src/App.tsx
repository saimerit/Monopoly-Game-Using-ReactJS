import React, { useRef, useState, useEffect, useCallback } from 'react';
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
type CardId = string;

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
    getOutOfJailFreeCards: number;
    houses: number;
    hotels: number;
}

interface PropertyState {
    owner: PlayerId | null;
    houses: number;
    hotels: number;
    mortgaged: boolean;
}

type BoardState = Record<string, PropertyState>;

interface AuctionState {
    active: boolean;
    propertyId?: PropertyId;
    currentBid?: number;
    highestBidder?: PlayerId | null;
    bidCount?: number;
    sellerId?: PlayerId | null; // For player-hosted auctions
    log: string[];
}

interface Trade {
    id: string;
    fromPlayer: PlayerId;
    toPlayer: PlayerId;
    offer: { money: number; properties: PropertyId[] };
    request: { money: number; properties: PropertyId[] };
    status: 'pending' | 'accepted' | 'rejected';
}

interface GameSettings {
    initialMoney: number;
    maxPlayers: number;
    allowAuctions: boolean;
    allowOwnedPropertyAuctions: boolean;
    allowMortgage: boolean;
    rentInJail: boolean;
    taxInVacationPot: boolean;
    doubleRentOnMonopoly: boolean;
}

interface Card {
    id: CardId;
    type: 'treasure' | 'surprise';
    text: string;
    action: (roomId: RoomId, playerId: PlayerId, gameState: GameState) => Promise<void>;
}


interface GameState {
    gameId: RoomId;
    hostId: PlayerId;
    status: 'waiting' | 'in-progress' | 'finished';
    board: BoardState;
    settings: GameSettings;
    players: Record<PlayerId, Player>;
    turnOrder: PlayerId[];
    currentPlayerTurn: PlayerId;
    gameLog: string[];
    vacationPot: number;
    auction: AuctionState;
    trades: Record<string, Trade>;
    winner?: PlayerId;
    propertyVisits: Record<PropertyId, number>;
    drawnCard?: Card;
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
    rent: number[];
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
const generateId = (): string => Math.random().toString(36).substring(2, 10);


const playerColors: string[] = ['#d9534f', '#5cb85c', '#0275d8', '#f0ad4e', '#5bc0de', '#9b59b6', '#34495e', '#e74c3c'];

const countryData: Record<string, { cities: number[]; houseCost: number }> = {
    "Brazil":    { cities: [1, 3, 6],    houseCost: 50 },
    "China":    { cities: [8, 9, 11],   houseCost: 50 },
    "Japan":    { cities: [33, 35],     houseCost: 100 },
    "Germany":  { cities: [24, 25, 27], houseCost: 100 },
    "Russia":   { cities: [29, 30, 32], houseCost: 150 },
    "France":   { cities: [17, 18, 20, 22], houseCost: 150 },
    "UK":       { cities: [43, 44, 46, 48], houseCost: 200 },
    "Canada":   { cities: [13, 15],     houseCost: 200 },
    "India":   { cities: [37, 39, 41], houseCost: 220 },
    "Australia":{ cities: [49, 51, 52], houseCost: 220 },
    "USA":      { cities: [53, 54, 55], houseCost: 250 },
};

const countryFlags: Record<string, ReactNode> = {
    "India": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/4/41/Flag_of_India.svg/125px-Flag_of_India.svg.png" alt="India Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "China": ( <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Flag_of_the_People%27s_Republic_of_China.svg/125px-Flag_of_the_People%27s_Republic_of_China.svg.png" alt="China Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Japan": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/9/9e/Flag_of_Japan.svg/125px-Flag_of_Japan.svg.png" alt="Japan Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Germany": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/b/ba/Flag_of_Germany.svg/125px-Flag_of_Germany.svg.png" alt="Germany Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Russia": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f3/Flag_of_Russia.svg/125px-Flag_of_Russia.svg.png" alt="Russia Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "France": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/c/c3/Flag_of_France.svg/125px-Flag_of_France.svg.png" alt="France Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "UK": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/a/ae/Flag_of_the_United_Kingdom.svg/125px-Flag_of_the_United_Kingdom.svg.png" alt="UK Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Canada": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/c/cf/Flag_of_Canada.svg/125px-Flag_of_Canada.svg.png" alt="Canada Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Brazil": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/0/05/Flag_of_Brazil.svg/125px-Flag_of_Brazil.svg.png" alt="Brazil Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "Australia": ( <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Flag_of_Australia_%28converted%29.svg/125px-Flag_of_Australia_%28converted%29.svg.png" alt="Australia Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
    "USA": ( <img src="https://upload.wikimedia.org/wikipedia/en/thumb/a/a4/Flag_of_the_United_States.svg/125px-Flag_of_the_United_States.svg.png" alt="USA Flag" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> ),
};

const initialBoardState: Record<string, BoardSquare> = {
    0: { name: "GO", type: "go" },
    1: { name: "Rio de Janeiro", type: "city", country: "Brazil", cost: 60, rent: [4, 20, 60, 180, 320, 450] },
    2: { name: "Treasure Chest", type: "treasure" },
    3: { name: "Sao Paulo", type: "city", country: "Brazil", cost: 60, rent: [4, 20, 60, 180, 320, 450] },
    4: { name: "Income Tax (10%)", type: "tax", amount: 0.10 },
    5: { name: "Airport 1", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    6: { name: "Brasilia", type: "city", country: "Brazil", cost: 80, rent: [6, 30, 90, 270, 400, 550] },
    7: { name: "Surprise", type: "surprise" },
    8: { name: "Beijing", type: "city", country: "China", cost: 100, rent: [6, 30, 90, 270, 400, 550] },
    9: { name: "Shanghai", type: "city", country: "China", cost: 100, rent: [6, 30, 90, 270, 400, 550] },
    10: { name: "Harbour 1", type: "harbour", cost: 150, rent: [4, 10] },
    11: { name: "Shenzhen", type: "city", country: "China", cost: 120, rent: [8, 40, 100, 300, 450, 600] },
    12: { name: "Tech Corp", type: "company", cost: 150, rent: [] },
    13: { name: "Toronto", type: "city", country: "Canada", cost: 140, rent: [10, 50, 150, 450, 625, 750] },
    14: { name: "Jail / Visiting", type: "jail" },
    15: { name: "Vancouver", type: "city", country: "Canada", cost: 160, rent: [12, 60, 180, 500, 700, 900] },
    16: { name: "Airport 2", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    17: { name: "Paris", type: "city", country: "France", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    18: { name: "Marseille", type: "city", country: "France", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    19: { name: "Treasure Chest", type: "treasure" },
    20: { name: "Lyon", type: "city", country: "France", cost: 200, rent: [16, 80, 220, 600, 800, 1000] },
    21: { name: "Harbour 2", type: "harbour", cost: 150, rent: [4, 10] },
    22: { name: "Nice", type: "city", country: "France", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    23: { name: "Surprise", type: "surprise" },
    24: { name: "Berlin", type: "city", country: "Germany", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    25: { name: "Munich", type: "city", country: "Germany", cost: 240, rent: [20, 100, 300, 750, 925, 1100] },
    26: { name: "Energy Corp", type: "company", cost: 150, rent: [] },
    27: { name: "Hamburg", type: "city", country: "Germany", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    28: { name: "Vacation", type: "vacation" },
    29: { name: "Moscow", type: "city", country: "Russia", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    30: { name: "St. Petersburg", type: "city", country: "Russia", cost: 280, rent: [24, 120, 360, 850, 1025, 1200] },
    31: { name: "Airport 3", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    32: { name: "Kazan", type: "city", country: "Russia", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    33: { name: "Tokyo", type: "city", country: "Japan", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    34: { name: "Treasure Chest", type: "treasure" },
    35: { name: "Osaka", type: "city", country: "Japan", cost: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
    36: { name: "Harbour 3", type: "harbour", cost: 150, rent: [4, 10] },
    37: { name: "Mumbai", type: "city", country: "India", cost: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    38: { name: "Surprise", type: "surprise" },
    39: { name: "Delhi", type: "city", country: "India", cost: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
    40: { name: "Luxury Tax $75", type: "tax", amount: 100 },
    40: { name: "Luxury Tax $75", type: "tax", amount: 100 },
    41: { name: "Hyderabad", type: "city", country: "India", cost: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    42: { name: "Go to Jail", type: "go-to-jail-square" },
    43: { name: "London", type: "city", country: "UK", cost: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    44: { name: "Manchester", type: "city", country: "UK", cost: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
    45: { name: "Airport 4", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    46: { name: "Liverpool", type: "city", country: "UK", cost: 425, rent: [55, 225, 650, 1500, 1800, 2100] },
    47: { name: "Treasure Chest", type: "treasure" },
    48: { name: "Glasgow", type: "city", country: "UK", cost: 425, rent: [55, 225, 650, 1500, 1800, 2100] },
    49: { name: "Sydney", type: "city", country: "Australia", cost: 450, rent: [60, 250, 700, 1600, 1900, 2200] },
    50: { name: "Harbour 4", type: "harbour", cost: 150, rent: [4, 10] },
    51: { name: "Melbourne", type: "city", country: "Australia", cost: 475, rent: [65, 275, 750, 2000, 2400] },
    52: { name: "Canberra", type: "city", country: "Australia", cost: 500, rent: [70, 300, 800, 1800, 2100, 2500] },
    53: { name: "New York", type: "city", country: "USA", cost: 550, rent: [75, 325, 850, 1900, 2200, 2600] },
    54: { name: "Los Angeles", type: "city", country: "USA", cost: 550, rent: [75, 325, 850, 1900, 2200, 2600] },
    55: { name: "Chicago", type: "city", country: "USA", cost: 600, rent: [80, 350, 900, 2000, 2400, 2800] },
};

const getInitialDynamicBoardState = (): BoardState => {
    const board: BoardState = {};
    for (const pos in initialBoardState) {
        const square = initialBoardState[pos];
        if (['city', 'airport', 'harbour', 'company'].includes(square.type)) {
            board[pos] = { owner: null, houses: 0, hotels: 0, mortgaged: false };
        }
    }
    return board;
};
const treasureChestCards: Omit<Card, 'action'>[] = [
    { id: 'TC01', type: 'treasure', text: 'Get out of Jail Free: This card may be kept until needed, or traded.' },
    { id: 'TC02', type: 'treasure', text: 'Advance to Go: Collect $300.' },
    { id: 'TC03', type: 'treasure', text: 'Bank error in your favor: Collect $200.' },
    { id: 'TC04', type: 'treasure', text: "Doctor's fees: Pay $50." },
    { id: 'TC05', type: 'treasure', text: 'From sale of stock you get $50.' },
    { id: 'TC06', type: 'treasure', text: 'Go to Jail: Go directly to Jail. Do not pass Go, do not collect $200.' },
    { id: 'TC07', type: 'treasure', text: 'Grand Opera Night: Collect $50 from every player for opening night seats.' },
    { id: 'TC08', type: 'treasure', text: 'Holiday Fund matures: Receive $100.' },
    { id: 'TC09', type: 'treasure', text: 'Income tax refund: Collect $20.' },
    { id: 'TC10', type: 'treasure', text: 'It is your birthday: Collect $10 from every player.' },
    { id: 'TC11', type: 'treasure', text: 'Life insurance matures: Collect $100.' },
    { id: 'TC12', type: 'treasure', text: 'Pay hospital fees of $100.' },
    { id: 'TC13', type: 'treasure', text: 'Pay school fees of $150.' },
    { id: 'TC14', type: 'treasure', text: 'Receive $25 consultancy fee.' },
    { id: 'TC15', type: 'treasure', text: 'You are assessed for street repairs: Pay $40 per house and $115 per hotel you own.' },
    { id: 'TC16', type: 'treasure', text: 'You have won second prize in a beauty contest: Collect $10.' },
    { id: 'TC17', type: 'treasure', text: 'You inherit $100.' },
    { id: 'TC18', type: 'treasure', text: "It's time to renovate! Pay $120 for each house you own." },
    { id: 'TC19', type: 'treasure', text: 'Property taxes are due: Pay $50 for each house and $125 for each hotel.' },
    { id: 'TC20', type: 'treasure', text: 'You won a local gardening competition! Receive $20 for each house you own.' },
    { id: 'TC21', type: 'treasure', text: 'Vacation Time! Advance to the Vacation space. Collect the vacation pot.' },
    { id: 'TC22', type: 'treasure', text: 'You won a travel voucher! Collect $100 for your next trip.' },
    { id: 'TC23', type: 'treasure', text: 'Your flight was canceled. The airline has compensated you $150.' },
    { id: 'TC24', type: 'treasure', text: 'Advance to London. If you pass Go, collect $200.' },
];

const surpriseCards: Omit<Card, 'action'>[] = [
    { id: 'S01', type: 'surprise', text: 'Advance to Go: Collect $300.' },
    { id: 'S02', type: 'surprise', text: 'Advance to the nearest Airport: If unowned, you may buy it from the Bank. If owned, pay the owner twice the rental to which they are otherwise entitled.' },
    { id: 'S03', type: 'surprise', text: 'Advance to the nearest utility: If unowned, you may buy it from the Bank. If owned, throw dice and pay the owner a total ten times the amount thrown.' },
    { id: 'S04', type: 'surprise', text: 'Bank pays you a dividend of $50.' },
    { id: 'S05', type: 'surprise', text: 'Get out of Jail Free: This card may be kept until needed, or traded.' },
    { id: 'S06', type: 'surprise', text: 'Go Back 3 Spaces.' },
    { id: 'S07', type: 'surprise', text: 'Go to Jail: Go directly to Jail. Do not pass Go, do not collect $200.' },
    { id: 'S08', type: 'surprise', text: 'Make general repairs on all your property: For each house pay $25, for each hotel pay $100.' },
    { id: 'S09', type: 'surprise', text: 'Pay poor tax of $15.' },
    { id: 'S10', type: 'surprise', text: 'Take a trip to Airport 1: If you pass Go, collect $200.' },
    { id: 'S11', type: 'surprise', text: 'You have been elected Chairman of the Board: Pay each player $50.' },
    { id: 'S12', type: 'surprise', text: 'Your building and loan matures: Collect $150.' },
    { id: 'S13', type: 'surprise', text: 'You have won a crossword competition: Collect $100.' },
    { id: 'S14', type: 'surprise', text: 'Home Improvement Loan Matures: Collect $75 for each house you own.' },
    { id: 'S15', type: 'surprise', text: 'A zoning change benefits your properties! Collect $30 for each house and $100 for each hotel.' },
    { id: 'S16', type: 'surprise', text: 'Street beautification assessment: Pay $30 for each house you own.' },
    { id: 'S17', type: 'surprise', text: 'Have a vacation and a trip to New York! Advance to the Vacation space, collect the vacation pot, and then immediately move to New York. If you pass Go, collect $200.' },
    { id: 'S18', type: 'surprise', text: 'Lost your luggage! Pay $100 to the vacation pot.' },
    { id: 'S19', type: 'surprise', text: "Won a free vacation! Go to the vacation space. Do NOT collect the vacation pot. Your turn ends." },
    { id: 'S20', type: 'surprise', text: 'Business trip to Tokyo! Advance to Tokyo. If you pass Go, collect $200.' },
];
// ==========================================================
// CORE GAME LOGIC FUNCTIONS
// ==========================================================
const handleCardAction = async (roomId: RoomId, playerId: PlayerId, gameState: GameState, card: Card) => {
    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);
    const updates: DocumentData = { [`players.${playerId}.money`]: increment(0) };
    let moneyToPot = 0;
    let updatesApplied = false;

    switch (card.id) {
        // Treasure Chest Cards
        case 'TC01': await updateDoc(gameRef, { [`players.${playerId}.getOutOfJailFreeCards`]: increment(1) }); break;
        case 'TC02': await updateDoc(gameRef, { [`players.${playerId}.position`]: 0, [`players.${playerId}.money`]: increment(300) }); break;
        case 'TC03': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(200) }); break;
        case 'TC04': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-50), vacationPot: increment(50) }); break;
        case 'TC05': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(50) }); break;
        case 'TC06': await goToJail(roomId, playerId, gameState); break;
        case 'TC01': updates[`players.${playerId}.getOutOfJailFreeCards`] = increment(1); updatesApplied = true; break;
        case 'TC02': updates[`players.${playerId}.position`] = 0; updates[`players.${playerId}.money`] = increment(300); updatesApplied = true; break;
        case 'TC03': updates[`players.${playerId}.money`] = increment(200); updatesApplied = true; break;
        case 'TC04': updates[`players.${playerId}.money`] = increment(-50); moneyToPot = 50; updatesApplied = true; break;
        case 'TC05': updates[`players.${playerId}.money`] = increment(50); updatesApplied = true; break;
        case 'TC06': await goToJail(roomId, playerId, gameState); return;
        case 'TC07': {
            const batch = writeBatch(db);
            const gameRef = doc(db, "games", roomId);
            Object.keys(gameState.players).forEach(pId => {
                if (pId !== playerId) {
                    batch.update(gameRef, { [`players.${pId}.money`]: increment(-50) });
                }
            });
            batch.update(gameRef, { [`players.${playerId}.money`]: increment(50 * (Object.keys(gameState.players).length - 1)) });
            await batch.commit();
            return;
        }
        case 'TC08': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC09': updates[`players.${playerId}.money`] = increment(20); updatesApplied = true; break;
        case 'TC10': {
            const batch = writeBatch(db);
            const gameRef = doc(db, "games", roomId);
            Object.keys(gameState.players).forEach(pId => {
                if (pId !== playerId) {
                    batch.update(gameRef, { [`players.${pId}.money`]: increment(-10) });
                }
            });
            batch.update(gameRef, { [`players.${playerId}.money`]: increment(10 * (Object.keys(gameState.players).length - 1)) });
            await batch.commit();
            return;
        }
        case 'TC11': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(100) }); break;
        case 'TC12': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-100), vacationPot: increment(100) }); break;
        case 'TC13': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-150), vacationPot: increment(150) }); break;
        case 'TC14': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(25) }); break;
        case 'TC11': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC12': updates[`players.${playerId}.money`] = increment(-100); moneyToPot = 100; updatesApplied = true; break;
        case 'TC13': updates[`players.${playerId}.money`] = increment(-150); moneyToPot = 150; updatesApplied = true; break;
        case 'TC14': updates[`players.${playerId}.money`] = increment(25); updatesApplied = true; break;
        case 'TC15': {
            const streetRepairsCost = (player.houses * 40) + (player.hotels * 115);
            await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-streetRepairsCost), vacationPot: increment(streetRepairsCost) });
            updates[`players.${playerId}.money`] = increment(-streetRepairsCost);
            moneyToPot = streetRepairsCost;
            updatesApplied = true;
            break;
        }
        case 'TC16': updates[`players.${playerId}.money`] = increment(10); updatesApplied = true; break;
        case 'TC17': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC18': {
            const renovationCost = player.houses * 120;
            await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-renovationCost), vacationPot: increment(renovationCost) });
            updates[`players.${playerId}.money`] = increment(-renovationCost);
            moneyToPot = renovationCost;
            updatesApplied = true;
            break;
        }
        case 'TC19': {
            const propertyTaxes = (player.houses * 50) + (player.hotels * 125);
            await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-propertyTaxes), vacationPot: increment(propertyTaxes) });
            updates[`players.${playerId}.money`] = increment(-propertyTaxes);
            moneyToPot = propertyTaxes;
            updatesApplied = true;
            break;
        }
        case 'TC20': {
            const gardeningWinnings = player.houses * 20;
            updates[`players.${playerId}.money`] = increment(gardeningWinnings);
            updatesApplied = true;
            break;
        }
        case 'TC21': {
            const pot = gameState.vacationPot || 0;
            updates[`players.${playerId}.position`] = 28;
            updates[`players.${playerId}.money`] = increment(pot);
            updates.vacationPot = 0;
            updatesApplied = true;
            break;
        }
        case 'TC22': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC23': updates[`players.${playerId}.money`] = increment(150); updatesApplied = true; break;
        case 'TC24': {
            const toLondon = 43;
            if (player.position > toLondon) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toLondon;
            updatesApplied = true;
            break;
        }
        // Surprise Cards
        case 'S01': updates[`players.${playerId}.position`] = 0; updates[`players.${playerId}.money`] = increment(300); updatesApplied = true; break;
        case 'S02': {
            const airports = [5, 16, 31, 45];
            let nearestAirport = airports[0];
            let minDistance = 56;
            for (const airport of airports) {
                let distance = airport - player.position;
                if (distance < 0) distance += 56;
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestAirport = airport;
                }
            }
            updates[`players.${playerId}.position`] = nearestAirport;
            updatesApplied = true;
            break;
        }
        case 'S03': {
            const utilities = [12, 26]; // Tech Corp, Energy Corp
            let nearestUtility = utilities[0];
            let minDistance = 56;
            for (const utility of utilities) {
                let distance = utility - player.position;
                if (distance < 0) distance += 56;
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestUtility = utility;
                }
            }
            updates[`players.${playerId}.position`] = nearestUtility;
            updatesApplied = true;
            break;
        }
        case 'S04': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(50) }); break;
        case 'S05': await updateDoc(gameRef, { [`players.${playerId}.getOutOfJailFreeCards`]: increment(1) }); break;
        case 'S06': {
            const newPosition = (player.position - 3 + 56) % 56;
            await updateDoc(gameRef, { [`players.${playerId}.position`]: newPosition });
            const updatedGameDoc = await getDoc(gameRef);
            if (updatedGameDoc.exists()) {
                const updatedGameState = updatedGameDoc.data() as GameState;
                await handleLandingOnSquare(roomId, playerId, newPosition, 0, updatedGameState);
            }
            break;
        }
        case 'S07': await goToJail(roomId, playerId, gameState); break;
        case 'S04': updates[`players.${playerId}.money`] = increment(50); updatesApplied = true; break;
        case 'S05': updates[`players.${playerId}.getOutOfJailFreeCards`] = increment(1); updatesApplied = true; break;
        case 'S06': {
            const newPosition = (player.position - 3 + 56) % 56;
            updates[`players.${playerId}.position`] = newPosition;
            updatesApplied = true;
            await updateDoc(gameRef, updates);
            const updatedGameDoc = await getDoc(gameRef);
            if (updatedGameDoc.exists()) {
                const updatedGameState = updatedGameDoc.data() as GameState;
                await handleLandingOnSquare(roomId, playerId, newPosition, 0, updatedGameState);
            }
            return;
        }
        case 'S07': await goToJail(roomId, playerId, gameState); return;
        case 'S08': {
            const generalRepairsCost = (player.houses * 25) + (player.hotels * 100);
            await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-generalRepairsCost), vacationPot: increment(generalRepairsCost) });
            updates[`players.${playerId}.money`] = increment(-generalRepairsCost);
            moneyToPot = generalRepairsCost;
            updatesApplied = true;
            break;
        }
        case 'S09': await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-15), vacationPot: increment(15) }); break;
        case 'S09': updates[`players.${playerId}.money`] = increment(-15); moneyToPot = 15; updatesApplied = true; break;
        case 'S10': {
            const toAirport1 = 5;
            if (player.position > toAirport1) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toAirport1;
            updatesApplied = true;
            break;
        }
        case 'S11': {
            const batch = writeBatch(db);
            const gameRef = doc(db, "games", roomId);
            Object.keys(gameState.players).forEach(pId => {
                if (pId !== playerId) {
                    batch.update(gameRef, { [`players.${pId}.money`]: increment(50) });
                }
            });
            batch.update(gameRef, { [`players.${playerId}.money`]: increment(-50 * (Object.keys(gameState.players).length - 1)) });
            await batch.commit();
            return;
        }
        case 'S12': updates[`players.${playerId}.money`] = increment(150); updatesApplied = true; break;
        case 'S13': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'S14': {
            const loanMatures = player.houses * 75;
            updates[`players.${playerId}.money`] = increment(loanMatures);
            updatesApplied = true;
            break;
        }
        case 'S15': {
            const zoningBenefit = (player.houses * 30) + (player.hotels * 100);
            updates[`players.${playerId}.money`] = increment(zoningBenefit);
            updatesApplied = true;
            break;
        }
        case 'S16': {
            const beautificationAssessment = player.houses * 30;
            await updateDoc(gameRef, { [`players.${playerId}.money`]: increment(-beautificationAssessment), vacationPot: increment(beautificationAssessment) });
            updates[`players.${playerId}.money`] = increment(-beautificationAssessment);
            moneyToPot = beautificationAssessment;
            updatesApplied = true;
            break;
        }
        case 'S17': {
            const toNewYork = 53;
            const pot = gameState.vacationPot || 0;
            if (player.position > toNewYork) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toNewYork;
            updates[`players.${playerId}.money`] = increment(pot);
            updates.vacationPot = 0;
            updatesApplied = true;
            break;
        }
        case 'S18': moneyToPot = 100; updatesApplied = true; break;
        case 'S19': updates[`players.${playerId}.position`] = 28; updatesApplied = true; break;
        case 'S20': {
            const toTokyo = 33;
            if (player.position > toTokyo) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toTokyo;
            updatesApplied = true;
            break;
        }
    }

    if (updatesApplied) {
        if (moneyToPot > 0 && gameState.settings.taxInVacationPot) {
            updates.vacationPot = increment(moneyToPot);
        }
        await updateDoc(gameRef, updates);
    }
};

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
            updates[`board.${pos}.hotels`] = 0;
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

    if (owner.inJail && !gameState.settings.rentInJail) {
        await updateDoc(doc(db, "games", roomId), {
            gameLog: arrayUnion(`${owner.name} is in jail and cannot collect rent.`)
        });
        return;
    }

    let rentAmount = 0;

    switch (squareInfo.type) {
        case 'city': {
            const country = countryData[squareInfo.country];
            const ownerHasMonopoly = country.cities.every(cityId => owner.cities.includes(String(cityId)));
            if (ownerHasMonopoly) {
                if (squareState.houses === 0 && gameState.settings.doubleRentOnMonopoly) {
                    rentAmount = (squareInfo.rent[0] || 0) * 2;
                } else {
                    rentAmount = squareInfo.rent[squareState.houses] || 0;
                }
            } else {
                rentAmount = squareInfo.rent[0] || 0;
            }
            if (squareState.hotels > 0) {
                rentAmount = squareInfo.rent[5];
            }
            break;
        }
        case 'airport': {
            const airportsOwned = owner.airports.length;
            rentAmount = squareInfo.rent[airportsOwned - 1] || 0;
            break;
        }
        case 'harbour': {
            rentAmount = squareInfo.rent[0] * diceRoll;
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
    
    await updateDoc(doc(db, "games", roomId), {
        [`players.${renterId}.money`]: increment(-rentAmount),
        [`players.${owner.id}.money`]: increment(rentAmount),
        gameLog: arrayUnion(`${renter.name} paid $${rentAmount} to ${owner.name}.`)
    });
};

const startAuction = async (roomId: RoomId, propertyId: PropertyId, sellerId: PlayerId | null = null) => {
    const gameDoc = await getDoc(doc(db, "games", roomId));
    if (!gameDoc.exists()) return;
    const gameState = gameDoc.data() as GameState;

    if (sellerId && !gameState.settings.allowOwnedPropertyAuctions) {
        alert("Auctioning owned properties is disabled for this game.");
        return;
    }

    if (!sellerId && !gameState.settings.allowAuctions) {
        alert("Auctions for unowned properties are disabled for this game.");
        return;
    }

    const property = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    await updateDoc(doc(db, "games", roomId), {
        auction: {
            active: true,
            propertyId: propertyId,
            currentBid: Math.floor(property.cost / 2),
            highestBidder: null,
            bidCount: 0,
            sellerId: sellerId,
            log: [`Auction started for ${property.name}!`],
        },
    });
};

const handleLandingOnSquare = async (roomId: RoomId, playerId: PlayerId, newPosition: number, diceRoll: number, gameState: GameState) => {
    const square = initialBoardState[newPosition];
    if (!square) return;
    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);
    await updateDoc(gameRef, {
    gameLog: arrayUnion(`${player.name} landed on ${square.name}.`),
    [`propertyVisits.${newPosition}`]: increment(1)
    gameLog: arrayUnion(`${player.name} landed on ${square.name}.`),
    [`propertyVisits.${newPosition}`]: increment(1)
    });
    switch (square.type) {
    case 'go':
    await updateDoc(gameRef, {
    [`players.${playerId}.money`]: increment(300),
    gameLog: arrayUnion(`${player.name} landed on GO and collected $300.`)
    });
    break;
    case 'city':
    case 'airport':
    case 'harbour':
    case 'company':
    if (gameState.board[newPosition].owner && gameState.board[newPosition].owner !== playerId) {
    await handlePayment(roomId, playerId, String(newPosition), diceRoll, gameState);
    }
    break;
    case 'tax': {
    const taxSquare = square as TaxSquare;
    const taxAmount = taxSquare.amount < 1 ? Math.floor(player.money * taxSquare.amount) : taxSquare.amount;
    const updates: DocumentData = {
    [`players.${playerId}.money`]: increment(-taxAmount),
    };
    let logMessage = `${player.name} paid $${taxAmount} for ${taxSquare.name}.`;
    if (gameState.settings.taxInVacationPot) {
    updates.vacationPot = increment(taxAmount);
    logMessage += ` The money goes to the vacation pot.`;
    }
    updates.gameLog = arrayUnion(logMessage);
    await updateDoc(gameRef, updates);
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
    case 'treasure': {
    const card = treasureChestCards[Math.floor(Math.random() * treasureChestCards.length)];
    await updateDoc(gameRef, {
        drawnCard: card,
        gameLog: arrayUnion(`${player.name} drew a Treasure Chest card: ${card.text}`)
    });
    await handleCardAction(roomId, playerId, gameState, { ...card, action: () => Promise.resolve() });
    break;
}
case 'surprise': {
    const card = surpriseCards[Math.floor(Math.random() * surpriseCards.length)];
    await updateDoc(gameRef, {
        drawnCard: card,
        gameLog: arrayUnion(`${player.name} drew a Surprise card: ${card.text}`)
    });
    await handleCardAction(roomId, playerId, gameState, { ...card, action: () => Promise.resolve() });
    break;
}
    case 'go':
    await updateDoc(gameRef, {
    [`players.${playerId}.money`]: increment(300),
    gameLog: arrayUnion(`${player.name} landed on GO and collected $300.`)
    });
    break;
    case 'city':
    case 'airport':
    case 'harbour':
    case 'company':
    if (gameState.board[newPosition].owner && gameState.board[newPosition].owner !== playerId) {
    await handlePayment(roomId, playerId, String(newPosition), diceRoll, gameState);
    }
    break;
    case 'tax': {
    const taxSquare = square as TaxSquare;
    const taxAmount = taxSquare.amount < 1 ? Math.floor(player.money * taxSquare.amount) : taxSquare.amount;
    const updates: DocumentData = {
    [`players.${playerId}.money`]: increment(-taxAmount),
    };
    let logMessage = `${player.name} paid $${taxAmount} for ${taxSquare.name}.`;
    if (gameState.settings.taxInVacationPot) {
    updates.vacationPot = increment(taxAmount);
    logMessage += ` The money goes to the vacation pot.`;
    }
    updates.gameLog = arrayUnion(logMessage);
    await updateDoc(gameRef, updates);
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
    case 'treasure': {
    const card = treasureChestCards[Math.floor(Math.random() * treasureChestCards.length)];
    await updateDoc(gameRef, {
        drawnCard: card,
        gameLog: arrayUnion(`${player.name} drew a Treasure Chest card: ${card.text}`)
    });
    await handleCardAction(roomId, playerId, gameState, { ...card, action: () => Promise.resolve() });
    break;
}
case 'surprise': {
    const card = surpriseCards[Math.floor(Math.random() * surpriseCards.length)];
    await updateDoc(gameRef, {
        drawnCard: card,
        gameLog: arrayUnion(`${player.name} drew a Surprise card: ${card.text}`)
    });
    await handleCardAction(roomId, playerId, gameState, { ...card, action: () => Promise.resolve() });
    break;
}
    }
    };
    };

const goToJail = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.position`]: 14,
        [`players.${playerId}.inJail`]: true,
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
    const ownershipArray = propertyTypeMap[property.type] as 'cities' | 'airports' | 'harbours' | 'companies';


    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(-property.cost),
        [`players.${playerId}.${ownershipArray}`]: arrayUnion(String(propertyPosition)),
        [`board.${propertyPosition}.owner`]: playerId,
        gameLog: arrayUnion(`${player.name} bought ${property.name} for $${property.cost}.`)
    });
};

const mortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
    if (!gameState.settings.allowMortgage) {
        alert("Mortgaging is disabled for this game.");
        return;
    }
    const propertyInfo = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    const propertyState = gameState.board[propertyId];

    if (propertyState.houses > 0 || propertyState.hotels > 0) {
        alert("You must sell all houses and hotels before mortgaging.");
        return;
    }
    if (propertyState.mortgaged) return; // Already mortgaged

    const mortgageValue = propertyInfo.cost / 2;
    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(mortgageValue),
        [`board.${propertyId}.mortgaged`]: true,
        gameLog: arrayUnion(`${gameState.players[playerId].name} mortgaged ${propertyInfo.name} for $${mortgageValue}.`)
    });
};

const unmortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
    if (!gameState.settings.allowMortgage) {
        alert("Mortgaging is disabled for this game.");
        return;
    }
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
    if (cityState.houses >= 4 && cityState.hotels === 0) {
        // Build a hotel
        await updateDoc(doc(db, "games", roomId), {
            [`players.${playerId}.money`]: increment(-countryInfo.houseCost),
            [`players.${playerId}.houses`]: increment(-4),
            [`players.${playerId}.hotels`]: increment(1),
            [`board.${cityId}.houses`]: 0,
            [`board.${cityId}.hotels`]: 1,
            gameLog: arrayUnion(`${player.name} built a hotel in ${cityInfo.name}.`)
        });
    } else if (cityState.houses < 4) {
        // Build a house
        await updateDoc(doc(db, "games", roomId), {
            [`players.${playerId}.money`]: increment(-countryInfo.houseCost),
            [`players.${playerId}.houses`]: increment(1),
            [`board.${cityId}.houses`]: increment(1),
            gameLog: arrayUnion(`${player.name} built a house in ${cityInfo.name}.`)
        });
    } else {
        alert("You cannot build any more on this property.");
        return;
    }
};

const sellHouse = async (roomId: RoomId, playerId: PlayerId, cityId: PropertyId, gameState: GameState) => {
    const cityInfo = initialBoardState[cityId] as CitySquare;
    const countryInfo = countryData[cityInfo.country];
    const cityState = gameState.board[cityId];

    const salePrice = countryInfo.houseCost / 2;

    if (cityState.hotels > 0) {
        // Sell a hotel
        await updateDoc(doc(db, "games", roomId), {
            [`players.${playerId}.money`]: increment(salePrice),
            [`players.${playerId}.hotels`]: increment(-1),
            [`players.${playerId}.houses`]: increment(4),
            [`board.${cityId}.hotels`]: 0,
            [`board.${cityId}.houses`]: 4,
            gameLog: arrayUnion(`${gameState.players[playerId].name} sold a hotel in ${cityInfo.name} for $${salePrice}.`)
        });
    } else if (cityState.houses > 0) {
        // Sell a house
        await updateDoc(doc(db, "games", roomId), {
            [`players.${playerId}.money`]: increment(salePrice),
            [`players.${playerId}.houses`]: increment(-1),
            [`board.${cityId}.houses`]: increment(-1),
            gameLog: arrayUnion(`${gameState.players[playerId].name} sold a house in ${cityInfo.name} for $${salePrice}.`)
        });
    } else {
        alert("There are no houses or hotels to sell on this property.");
        return;
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

interface AdminSettingsWidgetProps {
    gameState: GameState;
    roomId: RoomId;
    currentPlayerId: PlayerId;
}

const AdminSettingsWidget: FC<AdminSettingsWidgetProps> = ({ gameState, roomId, currentPlayerId }) => {
    const { settings } = gameState;
    const isHost = gameState.hostId === currentPlayerId;

    const handleSettingChange = async (setting: keyof GameSettings, value: boolean | number) => {
        if (gameState.status !== 'waiting' || !isHost) {
            alert("Settings can only be changed by the host before the game starts.");
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

    const ToggleButton: FC<{label: string, settingKey: keyof GameSettings, currentValue: boolean}> = ({label, settingKey, currentValue}) => (
        <div className="flex justify-between items-center bg-gray-800 p-2 rounded">
            <label htmlFor={settingKey} className="text-sm text-gray-300">{label}</label>
            <button
                id={settingKey}
                onClick={() => handleSettingChange(settingKey, !currentValue)}
                disabled={!isHost || gameState.status !== 'waiting'}
                className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${currentValue ? 'bg-green-500 text-white' : 'bg-red-500 text-white'} disabled:bg-gray-500 disabled:cursor-not-allowed`}
            >
                {currentValue ? 'ON' : 'OFF'}
            </button>
        </div>
    );

    return (
        <div className="bg-gray-700 p-2.5 rounded mb-4">
            <h2 className="text-xl font-semibold mb-2 text-center">Game Settings</h2>
            <div className="space-y-2">
                <div className="flex justify-between items-center bg-gray-800 p-2 rounded">
                    <label htmlFor="initialMoney" className="text-sm text-gray-300">Initial Money</label>
                    <select
                        id="initialMoney"
                        value={settings.initialMoney}
                        onChange={(e) => handleSettingChange('initialMoney', Number(e.target.value))}
                        disabled={!isHost || gameState.status !== 'waiting'}
                        className="p-1 bg-gray-700 border border-gray-500 rounded text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
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
    const maxPlayers = 8;

    const handleCreateGame = async () => {
        if (!playerName) return alert("Please enter your name.");
        
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
            },
            players: {
                [currentPlayerId]: { 
                    id: currentPlayerId, 
                    name: playerName, 
                    money: initialMoney, 
                    position: 0, 
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
            auction: { active: false, log: [] },
            trades: {},
            propertyVisits: {}
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
                    [`players.${currentPlayerId}`]: { 
                        id: currentPlayerId, 
                        name: playerName, 
                        money: gameData.settings.initialMoney, 
                        position: 0, 
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
                alert(error.message);
            } else {
                alert("An unknown error occurred.");
            }
        }
    };

    return (
        <div className="max-w-7xl mx-auto">
            <h1 className="text-5xl font-bold text-center mb-8">World Monopoly 訣</h1>
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
}

const AuctionModal: FC<ModalProps> = ({ gameState, roomId, currentPlayerId }) => {
    const [timer, setTimer] = useState(5);
    const { auction } = gameState;
    const property = auction.propertyId ? initialBoardState[auction.propertyId] as CitySquare | UtilitySquare : null;
    const me = gameState.players[currentPlayerId];

    const endAuction = useCallback(async () => {
        if (!property) return;
        const { highestBidder, currentBid, propertyId, sellerId } = auction;
        const updates: DocumentData = { "auction.active": false };
        let logMessage = "";
        
        if (highestBidder && currentBid && propertyId) {
            const winner = gameState.players[highestBidder];
            const propertyTypeMap: Record<string, keyof Player> = { 'city': 'cities', 'airport': 'airports', 'harbour': 'harbours', 'company': 'companies' };
            const ownershipArray = propertyTypeMap[property.type] as 'cities' | 'airports' | 'harbours' | 'companies';

            updates[`players.${highestBidder}.money`] = increment(-currentBid);
            updates[`players.${highestBidder}.${ownershipArray}`] = arrayUnion(String(propertyId));
            updates[`board.${propertyId}.owner`] = highestBidder;

            if (sellerId) {
                const sellerGets = Math.floor(currentBid * 0.9);
                const tax = currentBid - sellerGets;
                updates[`players.${sellerId}.money`] = increment(sellerGets);
                if (gameState.settings.taxInVacationPot) {
                    updates.vacationPot = increment(tax);
                }
                logMessage = `${winner.name} won the auction for ${property.name} from ${gameState.players[sellerId]?.name || 'Unknown'} with a bid of $${currentBid}!`;
            } else {
                logMessage = `${winner.name} won the auction for ${property.name} with a bid of $${currentBid}!`;
            }

        } else {
            logMessage = `Auction for ${property.name} ended with no bids.`;
        }
        updates.gameLog = arrayUnion(logMessage);
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
        if (me.money < newBid) return; // Button should be disabled, but as a safeguard
        await updateDoc(doc(db, "games", roomId), {
            "auction.currentBid": newBid,
            "auction.highestBidder": currentPlayerId,
            "auction.bidCount": increment(1),
            "auction.log": arrayUnion(`${me.name} bid $${newBid}.`)
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-8 rounded-lg border border-gray-600 text-center shadow-xl w-1/2">
                <h2 className="text-3xl font-bold mb-4">Auction for {property.name}</h2>
                {auction.sellerId && <p className="text-lg text-gray-400 mb-4">Auctioned by {gameState.players[auction.sellerId]?.name}</p>}
                <h3 className="text-2xl mb-2">Current Bid: ${auction.currentBid}</h3>
                <p className="mb-4">Highest Bidder: {gameState.players[auction.highestBidder || '']?.name || 'None'}</p>
                <div className="bg-gray-900 p-4 rounded-lg mb-4 h-48 overflow-y-auto">
                    {auction.log && auction.log.map((log, index) => <p key={index}>{log}</p>)}
                </div>
                <h3 className="text-4xl font-mono mb-6">Selling in: {timer}</h3>
                <div className="flex justify-center gap-6">
                    <button onClick={() => placeBid(10)} disabled={me.money < (auction.currentBid || 0) + 10} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded disabled:bg-gray-500">+$10</button>
                    <button onClick={() => placeBid(50)} disabled={me.money < (auction.currentBid || 0) + 50} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded disabled:bg-gray-500">+$50</button>
                    <button onClick={() => placeBid(100)} disabled={me.money < (auction.currentBid || 0) + 100} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded disabled:bg-gray-500">+$100</button>
                </div>
            </div>
        </div>
    );
};

interface TradeModalProps extends ModalProps {
    tradeId?: string;
    setShowTradeModal: (show: string | null) => void;
}

function TradeModal({ gameState, roomId, currentPlayerId, tradeId, setShowTradeModal }: TradeModalProps) {
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
        if (!tradePartnerId) return alert("Please select a player to trade with.");
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
        <div className="bg-gray-700 p-2.5 rounded mb-4">
            <h2 className="text-xl font-semibold mb-2">Open Trades</h2>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {pendingTrades.length > 0 ? pendingTrades.map(trade => {
                    const fromPlayer = gameState.players[trade.fromPlayer];
                    const toPlayer = gameState.players[trade.toPlayer];
                    return (
                        <div key={trade.id} className="bg-gray-800 p-2 rounded-md border border-gray-600 text-sm">
                            <p><strong>From:</strong> {fromPlayer.name}</p>
                            <p><strong>To:</strong> {toPlayer.name}</p>
                            {currentPlayerId === trade.toPlayer && (
                                <button onClick={() => onViewTrade(trade.id)} className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-xs">
                                    View Offer
                                </button>
                            )}
                             {currentPlayerId === trade.fromPlayer && (
                                <button onClick={() => handleCancelTrade(trade.id)} className="w-full mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs">
                                    Cancel Offer
                                </button>
                            )}
                        </div>
                    );
                }) : <p className="text-gray-400">No open trades.</p>}
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
    const sortedVisits = Object.entries(gameState.propertyVisits || {}).sort(([, a], [, b]) => b - a);

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
}
interface CardPopupProps {
    card: Card;
    onClose: () => void;
}
const CardPopup: FC<CardPopupProps> = ({ card, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 20000);
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

const Board: FC<BoardProps> = ({ gameState, currentPlayerId, roomId }) => {
    const { players, board: boardState } = gameState;
    const [activePopups, setActivePopups] = useState<Record<string, boolean>>({});
    const popupTimers = useRef<Record<string, NodeJS.Timeout>>({});

    const togglePopup = (i: number) => {
        // Clear any existing timers
        Object.values(popupTimers.current).forEach(clearTimeout);
        popupTimers.current = {};
    
        // If the clicked popup is already active, close all popups.
        // Otherwise, open the clicked one.
        setActivePopups(prev => {
            const isActive = !!prev[i];
            if (isActive) {
                return {};
            } else {
                const newActivePopups = { [i]: true };
                popupTimers.current[i] = setTimeout(() => {
                    setActivePopups({});
                }, 10000);
                return newActivePopups;
            }
        });
        // Clear any existing timers
        Object.values(popupTimers.current).forEach(clearTimeout);
        popupTimers.current = {};
    
        // If the clicked popup is already active, close all popups.
        // Otherwise, open the clicked one.
        setActivePopups(prev => {
            const isActive = !!prev[i];
            if (isActive) {
                return {};
            } else {
                const newActivePopups = { [i]: true };
                popupTimers.current[i] = setTimeout(() => {
                    setActivePopups({});
                }, 10000);
                return newActivePopups;
            }
        });
    };


    const getGridPosition = (i: number): { gridArea: string } => {
        let row, col;
        if (i >= 0 && i <= 14) { row = 15; col = 15 - i; }
        else if (i >= 15 && i <= 28) { row = 15 - (i - 14); col = 1; }
        else if (i >= 29 && i <= 42) { row = 1; col = 1 + (i - 28); }
        else { row = 1 + (i - 42); col = 15; }
        return { gridArea: `${row} / ${col}` };
    };

    const renderHouses = (houses: number, hotels: number) => {
        if (hotels > 0) {
            return '妾';
        }
        if (houses > 0) {
            return '匠'.repeat(houses);
        }
        return null;
    };

    const cells = Array.from({ length: 56 }, (_, i) => {
        const cellInfo = initialBoardState[i] as CitySquare | UtilitySquare | TaxSquare | BaseSquare;
        const cellState = boardState[i];
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
            wrapperStyle.width = '70px';
            wrapperStyle.height = '120px';
            popupPositionClass = 'left-full top-0 ml-2';
        }
        if (isRightSide) {
            wrapperStyle.transform = 'rotate(-90deg)';
            wrapperStyle.width = '70px';
            wrapperStyle.height = '120px';
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

        if (cellInfo.type === 'vacation') {
            return (
                <div key={i} className={`bg-gray-700 border border-gray-500 relative flex justify-center items-center text-xs text-center box-border group ${isCorner ? 'font-bold text-sm' : ''}`} style={getGridPosition(i)}>
                    <div className="content-wrapper" style={wrapperStyle}>
                        <div className="p-0.5 flex-grow flex items-center justify-center">{cellInfo.name}</div>
                        <div className="text-sm font-bold pb-1">${gameState.vacationPot || 0}</div>
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-0.5 w-12 justify-center">
                        {Object.values(players).map(p =>
                            p.position === i && <div key={p.id} className="w-4 h-4 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div key={i} onClick={() => togglePopup(i)} className={`bg-gray-700 border border-gray-500 relative flex justify-center items-center text-xs text-center box-border group ${isCorner ? 'font-bold text-sm' : ''}`} style={getGridPosition(i)}>
                <div className="content-wrapper" style={wrapperStyle}>
                    {hasColorBar && <div className="w-full h-8 border-b border-gray-500 overflow-hidden">{flagSvg}</div>}
                    <div className="p-0.5 flex-grow flex items-center justify-center">{cellInfo.name}</div>
                    
                    {!cellState?.owner && (cellInfo as UtilitySquare).cost && <div className="text-sm font-bold pb-1">${(cellInfo as UtilitySquare).cost}</div>}
                    
                    {ownerColor && (
                        <div className="w-full h-8 border-t border-gray-500 flex justify-center items-center" style={{ backgroundColor: ownerColor }}>
                            <span className="text-xs">{renderHouses(cellState.houses, cellState.hotels)}</span>
                        </div>
                    )}
                </div>
                {cellState?.mortgaged && <div className="absolute text-5xl text-red-500 text-opacity-70 font-bold">調</div>}
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-wrap gap-0.5 w-12 justify-center">
                    {Object.values(players).map(p => 
                        p.position === i && <div key={p.id} className="w-4 h-4 rounded-full border border-white shadow-md" style={{ backgroundColor: p.color }}></div>
                    )}
                </div>
                {(cellInfo.type === 'city' || cellInfo.type === 'airport' || cellInfo.type === 'harbour') && (
                    <div className={`absolute z-10 bg-purple-900 bg-opacity-95 ${activePopups[i] ? 'flex' : 'hidden'} flex-col items-center justify-center p-4 text-white text-sm w-72 h-auto rounded-lg shadow-lg ${popupPositionClass}`}>
                        <button onClick={(e) => { e.stopPropagation(); togglePopup(i); }} className="absolute top-2 right-2 text-gray-400 hover:text-white bg-transparent border-none">
                        <button onClick={(e) => { e.stopPropagation(); togglePopup(i); }} className="absolute top-2 right-2 text-gray-400 hover:text-white bg-transparent border-none">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <h4 className="font-bold mb-2 text-lg">{cellInfo.name}</h4>
                        {owner && <p className="text-xs mb-2">Owned by: {owner.name}</p>}
                        {cellInfo.type === 'city' && (
                            <table className="w-full text-left text-base mb-2">
                                <tbody>
                                    <tr><td>Rent</td><td>${(cellInfo as CitySquare).rent[0]}</td></tr>
                                    <tr><td>with 1 House</td><td>${(cellInfo as CitySquare).rent[1]}</td></tr>
                                    <tr><td>with 2 Houses</td><td>${(cellInfo as CitySquare).rent[2]}</td></tr>
                                    <tr><td>with 3 Houses</td><td>${(cellInfo as CitySquare).rent[3]}</td></tr>
                                    <tr><td>with 4 Houses</td><td>${(cellInfo as CitySquare).rent[4]}</td></tr>
                                    <tr><td>A Hotel</td><td>${(cellInfo as CitySquare).rent[5]}</td></tr>
                                </tbody>
                            </table>
                        )}
                         {(cellInfo.type === 'airport' || cellInfo.type === 'harbour') && (
                             <table className="w-full text-left text-base mb-2">
                                <tbody>
                                    <tr><td>1 Owned</td><td>${(cellInfo as UtilitySquare).rent[0]}</td></tr>
                                    <tr><td>2 Owned</td><td>${(cellInfo as UtilitySquare).rent[1]}</td></tr>
                                    <tr><td>3 Owned</td><td>${(cellInfo as UtilitySquare).rent[2]}</td></tr>
                                    <tr><td>4 Owned</td><td>${(cellInfo as UtilitySquare).rent[3]}</td></tr>
                                </tbody>
                            </table>
                        )}
                        {isMyProperty && (
                            <>
                                <button 
                                    onClick={() => cellState.mortgaged ? unmortgageProperty(roomId, currentPlayerId, String(i), gameState) : mortgageProperty(roomId, currentPlayerId, String(i), gameState)} 
                                    disabled={!gameState.settings.allowMortgage}
                                    className="w-full text-center py-1 bg-yellow-600 hover:bg-yellow-700 rounded mb-1 text-sm disabled:bg-gray-500 disabled:cursor-not-allowed">
                                        {cellState.mortgaged ? `Unmortgage ($${Math.ceil(((cellInfo as UtilitySquare).cost / 2) * 1.1)})` : `Mortgage ($${(cellInfo as UtilitySquare).cost / 2})`}
                                </button>
                                {cellInfo.type === 'city' && !cellState.mortgaged && (
                                    <div className="flex w-full gap-1 mb-1">
                                        <button onClick={() => buildHouse(roomId, currentPlayerId, String(i), gameState)} className="flex-1 text-center py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm">Build</button>
                                        <button onClick={() => sellHouse(roomId, currentPlayerId, String(i), gameState)} className="flex-1 text-center py-1 bg-orange-600 hover:bg-orange-700 rounded text-sm">Sell</button>
                                    </div>
                                )}
                                <button 
                                    onClick={() => startAuction(roomId, String(i), currentPlayerId)} 
                                    disabled={!gameState.settings.allowOwnedPropertyAuctions}
                                    className="w-full text-center py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-sm disabled:bg-gray-500 disabled:cursor-not-allowed">
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
        <div className="flex justify-center items-center p-5">
            <div className="grid grid-cols-[120px_repeat(13,_70px)_120px] grid-rows-[120px_repeat(13,_70px)_120px] gap-0.5 bg-black border-2 border-gray-500 relative">
                {cells}
                <div 
                    className="bg-[#3a4d3b] p-4 box-border flex items-center justify-center" 
                    style={{ gridColumn: '2 / 15', gridRow: '2 / 15' }}
                >
                    <div className="w-full h-full overflow-y-auto p-2.5 bg-green-900 bg-opacity-20 rounded text-gray-100">
                       {gameState.gameLog.slice().reverse().map((msg: string, i: number) => <p key={i} className="m-0 mb-1.5 pb-1.5 border-b border-dotted border-gray-500 text-lg">{msg}</p>)}
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
}

const GameRoom: FC<GameRoomProps> = ({ roomId, currentPlayerId }) => {
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [activeTradeModal, setActiveTradeModal] = useState<string | null>(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [hasRolled, setHasRolled] = useState(false);
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
            setHasRolled(true); // End movement phase after going to jail
            return;
        }
    
        const oldPosition = player.position;
        const newPosition = (oldPosition + diceRoll) % 56;
    
        const updates: DocumentData = {
            [`players.${currentPlayerId}.position`]: newPosition,
            [`players.${currentPlayerId}.doublesCount`]: doublesCount,
        };
        
        const logMessages = [`${player.name} rolled a ${diceRoll}${isDoubles ? ' (doubles!)' : ''}.`];
    
        if (newPosition < oldPosition && newPosition !== 0 && !player.inJail) {
            updates[`players.${currentPlayerId}.money`] = increment(200);
            logMessages.push(`${player.name} passed GO and collected $200.`);
        }
        
        updates.gameLog = arrayUnion(...logMessages);
    
        await updateDoc(doc(db, "games", roomId), updates);
        
        // Fetch the updated game state to pass to handleLandingOnSquare
        const updatedGameDoc = await getDoc(doc(db, "games", roomId));
        if (updatedGameDoc.exists()) {
            const updatedGameState = updatedGameDoc.data() as GameState;
            await handleLandingOnSquare(roomId, currentPlayerId, newPosition, diceRoll, updatedGameState);
        }
    
        setHasRolled(true);
    };

    const handleEndTurn = async () => {
        if (!gameState) return;
        const { turnOrder, currentPlayerTurn } = gameState;
        const player = gameState.players[currentPlayerTurn];
        
        if (player.money < 0) {
            alert("You must resolve your debt by selling houses or mortgaging properties before ending your turn.");
            return;
        }
    
        const updates: DocumentData = {
            [`players.${currentPlayerTurn}.doublesCount`]: 0,
            gameLog: arrayUnion(`${player.name}'s turn ended.`)
        };
    
        if (turnOrder.length > 1) {
            const currentIndex = turnOrder.indexOf(currentPlayerTurn);
            const nextPlayerId = turnOrder[(currentIndex + 1) % turnOrder.length];
            updates.currentPlayerTurn = nextPlayerId;
        }
    
        if (player.onVacation) {
            updates[`players.${currentPlayerTurn}.onVacation`] = false;
        }
        
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

    return (
        <div className="max-w-[1500px] mx-auto">
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <Board gameState={gameState} currentPlayerId={currentPlayerId} roomId={roomId} />
                <div className="flex-shrink-0 w-full lg:w-96 bg-gray-800 p-4 rounded-lg border border-gray-600 shadow-lg">
                    <h1 className="text-2xl font-bold mb-2">Room: {roomId}</h1>
                    <div className="bg-gray-700 p-2.5 rounded mb-4">
                        <p><strong>Admin:</strong> {gameState.players[gameState.hostId]?.name || 'N/A'}</p>
                        <p><strong>Vacation Pot:</strong> ${gameState.vacationPot || 0}</p>
                    </div>

                    {gameState.status === "waiting" && currentPlayerId === gameState.hostId && (
                        <div className="flex gap-2 mb-4">
                            <button onClick={handleStartGame} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">Start Game</button>
                            <button onClick={handleDeleteGame} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">Delete Game</button>
                        </div>
                    )}
                    
                    <AdminSettingsWidget gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} />

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
                                <button onClick={handleRollDice} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                                    {me.doublesCount > 0 ? "Roll Again" : "Roll Dice"}
                                </button>
                            )}
                            {me.doublesCount > 0 && !hasRolled && <p className="text-green-400 col-span-2 text-center">You rolled doubles! Roll again.</p>}

                            {hasRolled && !me.onVacation && (
                                <>
                                    {canBuy && <button onClick={() => buyProperty(roomId, currentPlayerId, me.position, gameState)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">Buy ({currentSquareInfo.name})</button>}
                                    {canBuy && <button onClick={() => startAuction(roomId, String(me.position))} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded">Auction</button>}
                                    
                                    {me.doublesCount === 0 ? (
                                        <button onClick={handleEndTurn} disabled={me.money < 0} className="col-span-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:bg-gray-700 disabled:cursor-not-allowed">End Turn</button>
                                    ) : (
                                        <button onClick={() => setHasRolled(false)} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Continue</button>
                                    )}
                                </>
                            )}
                            
                            {me.onVacation && (
                                <button onClick={handleEndTurn} className="col-span-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">End Turn</button>
                            )}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        <button onClick={() => handleBankruptcy(roomId, currentPlayerId, gameState)} disabled={gameState.status !== 'in-progress'} className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed">Declare Bankruptcy</button>
                        <button onClick={() => setActiveTradeModal('new')} disabled={gameState.status !== 'in-progress'} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed">Propose Trade</button>
                        <button onClick={() => setShowStatsModal(true)} disabled={gameState.status !== 'in-progress'} className="col-span-2 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed">Property Stats</button>
                        <button onClick={() => setShowVisitStatsModal(true)} disabled={gameState.status !== 'in-progress'} className="col-span-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed">Visit Stats</button>
                    </div>

                    {gameState.status === 'in-progress' && <TradesWidget gameState={gameState} currentPlayerId={currentPlayerId} onViewTrade={(tradeId) => setActiveTradeModal(tradeId)} />}
                    
                </div>
            </div>
            {activeTradeModal && <TradeModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} setShowTradeModal={setActiveTradeModal} tradeId={activeTradeModal === 'new' ? undefined : activeTradeModal} />}
            {gameState.auction?.active && <AuctionModal gameState={gameState} roomId={roomId} currentPlayerId={currentPlayerId} />}
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

export default App;