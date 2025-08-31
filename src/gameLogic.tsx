import { db } from './firebase';
import {
    doc, updateDoc, arrayUnion, deleteField,
    increment, getDoc,
    writeBatch
} from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import type { ReactNode } from 'react';

// ==========================================================
// TYPE DEFINITIONS
// ==========================================================
export type PlayerId = string;
export type RoomId = string;
export type PropertyId = string;
export type CardId = string;

export interface Player {
    id: PlayerId;
    name: string;
    money: number;
    position: number;
    animatedPosition: number;
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

export interface PropertyState {
    owner: PlayerId | null;
    houses: number;
    hotels: number;
    mortgaged: boolean;
}

export type BoardState = Record<string, PropertyState>;

export interface AuctionState {
    active: boolean;
    propertyId?: PropertyId;
    currentBid?: number;
    highestBidder?: PlayerId | null;
    bidCount?: number;
    sellerId?: PlayerId | null; // For player-hosted auctions
    log: string[];
    bids: Record<PlayerId, number>;
}

export interface Trade {
    id: string;
    fromPlayer: PlayerId;
    toPlayer: PlayerId;
    offer: { money: number; properties: PropertyId[] };
    request: { money: number; properties: PropertyId[] };
    status: 'pending' | 'accepted' | 'rejected';
}

export interface GameSettings {
    initialMoney: number;
    maxPlayers: number;
    allowAuctions: boolean;
    allowOwnedPropertyAuctions: boolean;
    allowMortgage: boolean;
    rentInJail: boolean;
    taxInVacationPot: boolean;
    doubleRentOnMonopoly: boolean;
    increasingJailFine: boolean;
}

export interface Card {
    id: CardId;
    type: 'treasure' | 'surprise';
    text: string;
    action: (roomId: RoomId, playerId: PlayerId, gameState: GameState) => Promise<void>;
}


export interface GameState {
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
    jailCount: Record<PlayerId, number>;
}

export interface BaseSquare {
    name: string;
    type: string;
}

export interface CitySquare extends BaseSquare {
    type: 'city';
    country: string;
    cost: number;
    rent: number[];
}

export interface UtilitySquare extends BaseSquare {
    type: 'airport' | 'harbour' | 'company';
    cost: number;
    rent: number[];
}

export interface TaxSquare extends BaseSquare {
    type: 'tax';
    amount: number;
}

export type BoardSquare = BaseSquare | CitySquare | UtilitySquare | TaxSquare;

// ==========================================================
// CONSTANTS & HELPERS
// ==========================================================
export const generateRoomId = (): string => Math.random().toString(36).substring(2, 8).toUpperCase();
export const generateId = (): string => Math.random().toString(36).substring(2, 10);


export const playerColors: string[] = ['#d9534f', '#5cb85c', '#0275d8', '#f0ad4e', '#5bc0de', '#9b59b6', '#34495e', '#e74c3c'];

export const countryData: Record<string, { cities: number[]; houseCost: number }> = {
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

export const countryFlags: Record<string, ReactNode> = {
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

export const initialBoardState: Record<string, BoardSquare> = {
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
    10: { name: "Harbour 1", type: "harbour", cost: 150, rent: [50, 100, 150, 200] },
    11: { name: "Shenzhen", type: "city", country: "China", cost: 120, rent: [8, 40, 100, 300, 450, 600] },
    12: { name: "Tech Corp", type: "company", cost: 150, rent: [4, 10] },
    13: { name: "Toronto", type: "city", country: "Canada", cost: 140, rent: [10, 50, 150, 450, 625, 750] },
    14: { name: "Jail / Visiting", type: "jail" },
    15: { name: "Vancouver", type: "city", country: "Canada", cost: 160, rent: [12, 60, 180, 500, 700, 900] },
    16: { name: "Airport 2", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    17: { name: "Paris", type: "city", country: "France", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    18: { name: "Marseille", type: "city", country: "France", cost: 180, rent: [14, 70, 200, 550, 750, 950] },
    19: { name: "Treasure Chest", type: "treasure" },
    20: { name: "Lyon", type: "city", country: "France", cost: 200, rent: [16, 80, 220, 600, 800, 1000] },
    21: { name: "Harbour 2", type: "harbour", cost: 150, rent: [50, 100, 150, 200] },
    22: { name: "Nice", type: "city", country: "France", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    23: { name: "Surprise", type: "surprise" },
    24: { name: "Berlin", type: "city", country: "Germany", cost: 220, rent: [18, 90, 250, 700, 875, 1050] },
    25: { name: "Munich", type: "city", country: "Germany", cost: 240, rent: [20, 100, 300, 750, 925, 1100] },
    26: { name: "Energy Corp", type: "company", cost: 150, rent: [4, 10] },
    27: { name: "Hamburg", type: "city", country: "Germany", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    28: { name: "Vacation", type: "vacation" },
    29: { name: "Moscow", type: "city", country: "Russia", cost: 260, rent: [22, 110, 330, 800, 975, 1150] },
    30: { name: "St. Petersburg", type: "city", country: "Russia", cost: 280, rent: [24, 120, 360, 850, 1025, 1200] },
    31: { name: "Airport 3", type: "airport", cost: 200, rent: [25, 50, 100, 200] },
    32: { name: "Kazan", type: "city", country: "Russia", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    33: { name: "Tokyo", type: "city", country: "Japan", cost: 300, rent: [26, 130, 390, 900, 1100, 1275] },
    34: { name: "Treasure Chest", type: "treasure" },
    35: { name: "Osaka", type: "city", country: "Japan", cost: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
    36: { name: "Harbour 3", type: "harbour", cost: 150, rent: [50, 100, 150, 200] },
    37: { name: "Mumbai", type: "city", country: "India", cost: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
    38: { name: "Surprise", type: "surprise" },
    39: { name: "Delhi", type: "city", country: "India", cost: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
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
    50: { name: "Harbour 4", type: "harbour", cost: 150, rent: [50, 100, 150, 200] },
    51: { name: "Melbourne", type: "city", country: "Australia", cost: 475, rent: [65, 275, 750, 2000, 2400] },
    52: { name: "Canberra", type: "city", country: "Australia", cost: 500, rent: [70, 300, 800, 1800, 2100, 2500] },
    53: { name: "New York", type: "city", country: "USA", cost: 550, rent: [75, 325, 850, 1900, 2200, 2600] },
    54: { name: "Los Angeles", type: "city", country: "USA", cost: 550, rent: [75, 325, 850, 1900, 2200, 2600] },
    55: { name: "Chicago", type: "city", country: "USA", cost: 600, rent: [80, 350, 900, 2000, 2400, 2800] },
};

export const getInitialDynamicBoardState = (): BoardState => {
    const board: BoardState = {};
    for (const pos in initialBoardState) {
        const square = initialBoardState[pos];
        if (['city', 'airport', 'harbour', 'company'].includes(square.type)) {
            board[pos] = { owner: null, houses: 0, hotels: 0, mortgaged: false };
        }
    }
    return board;
};
export const treasureChestCards: Omit<Card, 'action'>[] = [
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

export const surpriseCards: Omit<Card, 'action'>[] = [
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
export const handleCardAction = async (roomId: RoomId, playerId: PlayerId, gameState: GameState, card: Card) => {
    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);
    const updates: DocumentData = { [`players.${playerId}.money`]: increment(0) };
    let moneyToPot = 0;
    let updatesApplied = false;

    switch (card.id) {
        // Treasure Chest Cards
        case 'TC01':
            if (player.getOutOfJailFreeCards < 1) {
                updates[`players.${playerId}.getOutOfJailFreeCards`] = increment(1);
            }
            updatesApplied = true;
            break;
        case 'TC02': updates[`players.${playerId}.position`] = 0; updates[`players.${playerId}.animatedPosition`] = 0; updates[`players.${playerId}.money`] = increment(300); updatesApplied = true; break;
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
        case 'TC11': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC12': updates[`players.${playerId}.money`] = increment(-100); moneyToPot = 100; updatesApplied = true; break;
        case 'TC13': updates[`players.${playerId}.money`] = increment(-150); moneyToPot = 150; updatesApplied = true; break;
        case 'TC14': updates[`players.${playerId}.money`] = increment(25); updatesApplied = true; break;
        case 'TC15': {
            const streetRepairsCost = (player.houses * 40) + (player.hotels * 115);
            updates[`players.${playerId}.money`] = increment(-streetRepairsCost);
            moneyToPot = streetRepairsCost;
            updatesApplied = true;
            break;
        }
        case 'TC16': updates[`players.${playerId}.money`] = increment(10); updatesApplied = true; break;
        case 'TC17': updates[`players.${playerId}.money`] = increment(100); updatesApplied = true; break;
        case 'TC18': {
            const renovationCost = player.houses * 120;
            updates[`players.${playerId}.money`] = increment(-renovationCost);
            moneyToPot = renovationCost;
            updatesApplied = true;
            break;
        }
        case 'TC19': {
            const propertyTaxes = (player.houses * 50) + (player.hotels * 125);
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
            updates[`players.${playerId}.position`] = 28; updates[`players.${playerId}.animatedPosition`] = 28;
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
            updates[`players.${playerId}.position`] = toLondon; updates[`players.${playerId}.animatedPosition`] = toLondon;
            updatesApplied = true;
            break;
        }
        // Surprise Cards
        case 'S01': updates[`players.${playerId}.position`] = 0; updates[`players.${playerId}.animatedPosition`] = 0; updates[`players.${playerId}.money`] = increment(300); updatesApplied = true; break;
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
            updates[`players.${playerId}.position`] = nearestAirport; updates[`players.${playerId}.animatedPosition`] = nearestAirport;
            updatesApplied = true;
            await updateDoc(gameRef, updates);
            const airportState = gameState.board[String(nearestAirport)];
            if(airportState.owner && airportState.owner !== playerId){
                const owner = gameState.players[airportState.owner];
                const airportsOwned = owner.airports.length;
                const rentAmount = (initialBoardState[String(nearestAirport)] as UtilitySquare).rent[airportsOwned - 1] * 2;
                await updateDoc(gameRef, {
                    [`players.${playerId}.money`]: increment(-rentAmount),
                    [`players.${airportState.owner}.money`]: increment(rentAmount),
                    gameLog: arrayUnion(`${player.name} paid $${rentAmount} to ${owner.name}.`)
                });
            }
            return;
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
            updates[`players.${playerId}.position`] = nearestUtility; updates[`players.${playerId}.animatedPosition`] = nearestUtility;
            updatesApplied = true;
            await updateDoc(gameRef, updates);

            const utilityState = gameState.board[String(nearestUtility)];
            if(utilityState.owner && utilityState.owner !== playerId) {
                const diceRoll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
                const rentAmount = diceRoll * 10;
                await updateDoc(gameRef, {
                    [`players.${playerId}.money`]: increment(-rentAmount),
                    [`players.${utilityState.owner}.money`]: increment(rentAmount),
                    gameLog: arrayUnion(`${player.name} rolled a ${diceRoll} and paid $${rentAmount} to ${gameState.players[utilityState.owner].name}.`)
                });
            }

            return;
        }
        case 'S04': updates[`players.${playerId}.money`] = increment(50); updatesApplied = true; break;
        case 'S05':
            if (player.getOutOfJailFreeCards < 1) {
                updates[`players.${playerId}.getOutOfJailFreeCards`] = increment(1);
            }
            updatesApplied = true;
            break;
        case 'S06': {
            const newPosition = (player.position - 3 + 56) % 56;
            updates[`players.${playerId}.position`] = newPosition; updates[`players.${playerId}.animatedPosition`] = newPosition;
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
            updates[`players.${playerId}.money`] = increment(-generalRepairsCost);
            moneyToPot = generalRepairsCost;
            updatesApplied = true;
            break;
        }
        case 'S09': updates[`players.${playerId}.money`] = increment(-15); moneyToPot = 15; updatesApplied = true; break;
        case 'S10': {
            const toAirport1 = 5;
            if (player.position > toAirport1) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toAirport1; updates[`players.${playerId}.animatedPosition`] = toAirport1;
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
            updates[`players.${playerId}.position`] = toNewYork; updates[`players.${playerId}.animatedPosition`] = toNewYork;
            updates[`players.${playerId}.money`] = increment(pot);
            updates.vacationPot = 0;
            updatesApplied = true;
            break;
        }
        case 'S18': moneyToPot = 100; updatesApplied = true; break;
        case 'S19': updates[`players.${playerId}.position`] = 28; updates[`players.${playerId}.animatedPosition`] = 28; updatesApplied = true; break;
        case 'S20': {
            const toTokyo = 33;
            if (player.position > toTokyo) {
                updates[`players.${playerId}.money`] = increment(200);
            }
            updates[`players.${playerId}.position`] = toTokyo; updates[`players.${playerId}.animatedPosition`] = toTokyo;
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

export const handleBankruptcy = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
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

export const handlePayment = async (roomId: RoomId, renterId: PlayerId, squarePosition: PropertyId, diceRoll: number, gameState: GameState) => {
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
            const harboursOwned = owner.harbours.length;
            rentAmount = (squareInfo.rent[harboursOwned - 1] as number) || 0;
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

export const startAuction = async (roomId: RoomId, propertyId: PropertyId, startingBid: number, sellerId: PlayerId | null = null) => {
    const gameDoc = await getDoc(doc(db, "games", roomId));
    if (!gameDoc.exists()) return;
    const gameState = gameDoc.data() as GameState;

    if (sellerId && (!gameState.settings.allowOwnedPropertyAuctions || gameState.currentPlayerTurn !== sellerId)) {
        alert("Auctioning owned properties is disabled or it is not your turn.");
        return;
    }

    if (!sellerId && !gameState.settings.allowAuctions) {
        alert("Auctions for unowned properties are disabled for this game.");
        return;
    }
    
    await updateDoc(doc(db, "games", roomId), {
        auction: {
            active: true,
            propertyId: propertyId,
            currentBid: startingBid,
            highestBidder: null,
            bidCount: 0,
            sellerId: sellerId,
            log: [`Auction started for ${initialBoardState[propertyId].name} with a starting bid of $${startingBid}!`],
            bids: {}
        },
    });
};

export const handleLandingOnSquare = async (roomId: RoomId, playerId: PlayerId, newPosition: number, diceRoll: number, gameState: GameState) => {
    const square = initialBoardState[String(newPosition)];
    if (!square) return;
    const player = gameState.players[playerId];
    const gameRef = doc(db, "games", roomId);
    await updateDoc(gameRef, {
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
    if (gameState.board[String(newPosition)].owner && gameState.board[String(newPosition)].owner !== playerId) {
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

export const goToJail = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    const gameRef = doc(db, "games", roomId);
    const jailCount = (gameState.jailCount?.[playerId] || 0) + 1;
    await updateDoc(gameRef, {
        [`players.${playerId}.position`]: 14,
        [`players.${playerId}.animatedPosition`]: 14,
        [`players.${playerId}.inJail`]: true,
        [`players.${playerId}.jailTurns`]: 1,
        [`players.${playerId}.doublesCount`]: 0,
        [`jailCount.${playerId}`]: jailCount,
        gameLog: arrayUnion(`${gameState.players[playerId].name} was sent to Jail!`)
    });
};

export const payJailFine = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    const gameRef = doc(db, "games", roomId);
    const player = gameState.players[playerId];
    let fine = 100;
    if (gameState.settings.increasingJailFine) {
        fine = fine + ((gameState.jailCount?.[playerId] || 0) - 1) * 20;
    }
    if (player.money < fine) {
        alert("You do not have enough money to pay the fine.");
        return;
    }

    await updateDoc(gameRef, {
        [`players.${playerId}.money`]: increment(-fine),
        [`players.${playerId}.inJail`]: false,
        gameLog: arrayUnion(`${player.name} paid a $${fine} fine to get out of jail.`)
    });
};

export const handleUsePardonCard = async (roomId: RoomId, playerId: PlayerId, gameState: GameState) => {
    const gameRef = doc(db, "games", roomId);
    const player = gameState.players[playerId];

    if (player.getOutOfJailFreeCards <= 0) {
        alert("You do not have a Get Out of Jail Free card.");
        return;
    }

    await updateDoc(gameRef, {
        [`players.${playerId}.getOutOfJailFreeCards`]: increment(-1),
        [`players.${playerId}.inJail`]: false,
        gameLog: arrayUnion(`${player.name} used a Get Out of Jail Free card to get out of jail.`)
    });
};

export const buyProperty = async (roomId: RoomId, playerId: PlayerId, propertyPosition: number, gameState: GameState) => {
    const player = gameState.players[playerId];
    const property = initialBoardState[String(propertyPosition)] as CitySquare | UtilitySquare;
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

export const sellProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
    const propertyInfo = initialBoardState[propertyId] as CitySquare | UtilitySquare;
    const propertyState = gameState.board[propertyId];

    if (propertyState.houses > 0 || propertyState.hotels > 0) {
        alert("You must sell all houses and hotels before selling the property.");
        return;
    }
    if (propertyState.mortgaged) {
        alert("You must unmortgage the property before selling it.");
        return;
    }
    if (propertyState.owner !== playerId) return;

    const sellValue = propertyInfo.cost / 2;
    const player = gameState.players[playerId];

    const propertyTypeMap: Record<string, keyof Player> = { 'city': 'cities', 'airport': 'airports', 'harbour': 'harbours', 'company': 'companies' };
    const ownershipArray = propertyTypeMap[propertyInfo.type] as 'cities' | 'airports' | 'harbours' | 'companies';

    const updates: DocumentData = {
        [`players.${playerId}.money`]: increment(sellValue),
        [`board.${propertyId}.owner`]: null,
        gameLog: arrayUnion(`${player.name} sold ${propertyInfo.name} back to the bank for $${sellValue}.`)
    };

    if (player[ownershipArray].includes(propertyId)) {
      const newProperties = player[ownershipArray].filter(p => p !== propertyId);
      updates[`players.${playerId}.${ownershipArray}`] = newProperties;
    }
    
    await updateDoc(doc(db, "games", roomId), updates);
};

export const mortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
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
    if (propertyState.owner !== playerId) {
        alert("You can only mortgage your own properties.");
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

export const unmortgageProperty = async (roomId: RoomId, playerId: PlayerId, propertyId: PropertyId, gameState: GameState) => {
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
    if (gameState.board[propertyId].owner !== playerId) {
        alert("You can only unmortgage your own properties.");
        return;
    }

    await updateDoc(doc(db, "games", roomId), {
        [`players.${playerId}.money`]: increment(-unmortgageCost),
        [`board.${propertyId}.mortgaged`]: false,
        gameLog: arrayUnion(`${player.name} unmortgaged ${propertyInfo.name}.`)
    });
};

export const buildHouse = async (roomId: RoomId, playerId: PlayerId, cityId: PropertyId, gameState: GameState) => {
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

export const sellHouse = async (roomId: RoomId, playerId: PlayerId, cityId: PropertyId, gameState: GameState) => {
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