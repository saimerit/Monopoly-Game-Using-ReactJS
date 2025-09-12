// src/Leaderboard.tsx

import React, { useState, useEffect } from 'react';
import { getLeaderboard,type LeaderboardEntry } from './gameLogic';

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
                <div className="absolute top-12 left-0 bg-gray-800 p-4 rounded-lg border border-gray-600 shadow-lg w-auto">
                    <h2 className="text-xl font-bold mb-2">Leaderboard</h2>
                    <table className="w-full text-left">
                        <thead>
                            <tr>
                                <th className="p-2">Name</th>
                                <th className="p-2">Wins</th>
                                <th className="p-2">Losses</th>
                                <th className="p-2">Win Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaderboard.map((player, index) => {
                                const totalGames = player.wins + player.losses;
                                const winRate = totalGames > 0 ? ((player.wins / totalGames) * 100).toFixed(2) + '%' : 'N/A';
                                return (
                                    <tr key={index} className="border-b border-gray-700">
                                        <td className="p-2">{player.name}</td>
                                        <td className="p-2">{player.wins}</td>
                                        <td className="p-2">{player.losses}</td>
                                        <td className="p-2">{winRate}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default Leaderboard;