// src/Leaderboard.tsx

import React, { useState, useEffect } from 'react';
import { getLeaderboard, type LeaderboardEntry } from './gameLogic';

const Leaderboard: React.FC = () => {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);

    useEffect(() => {
        if (showLeaderboard) {
            const fetchLeaderboard = async () => {
                const data = await getLeaderboard();
                setLeaderboard(data);
            };
            fetchLeaderboard();
        }
    }, [showLeaderboard]);

    return (
        <div className="absolute top-4 left-4">
            <button onClick={() => setShowLeaderboard(!showLeaderboard)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded">
                Leaderboard
            </button>
            {showLeaderboard && (
                <div className="absolute top-12 left-0 bg-gray-800 p-4 rounded-lg border border-gray-600 shadow-lg w-64">
                    <h2 className="text-xl font-bold mb-2">Leaderboard</h2>
                    <ol className="list-decimal list-inside">
                        {leaderboard.map((player, index) => (
                            <li key={index} className="flex justify-between">
                                <span>{player.name}</span>
                                <span>{player.wins}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
};

export default Leaderboard;