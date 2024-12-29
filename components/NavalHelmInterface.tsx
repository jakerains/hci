'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVoiceRecognition } from '../hooks/useVoiceRecognition'
import { useToast } from "./ui/use-toast"
import ShipStatus from './ShipStatus'
import CommandLog from './CommandLog'
import CompassDisplay from './CompassDisplay'
import { ElevenLabsClient } from 'elevenlabs'
import { useTheme } from '@/contexts/ThemeContext'
import { ThemeSwitcher } from './ThemeSwitcher'

// Naval command patterns and configurations
const NAVAL_PATTERNS = {
  RUDDER: {
    ANGLES: {
      HARD: 35,
      FULL: 30,
      STANDARD: 15,
      HALF: 10,
      SLIGHT: 5
    },
    COMMANDS: {
      AMIDSHIPS: /\b(?:rudder\s+)?amidships\b/i,
      MEET_HER: /\bmeet\s+her\b/i,
      SHIFT: /\bshift\s+(?:your\s+)?rudder\b/i,
      EASE: /\b(?:ease|check)\s+(?:your\s+)?(?:swing|turn)\b/i
    }
  },
  SPEED: {
    AHEAD: {
      'emergency flank': 110,
      'flank': 100,
      'full': 90,
      'standard': 75,
      'two thirds': 67,
      'half': 50,
      'one third': 33,
      'slow': 25,
      'dead slow': 10,
      'stop': 0
    },
    ASTERN: {
      'emergency full': -100,
      'full': -75,
      'half': -50,
      'slow': -25,
      'stop': 0
    }
  },
  COURSE: {
    CARDINAL: {
      'north': 0,
      'northeast': 45,
      'east': 90,
      'southeast': 135,
      'south': 180,
      'southwest': 225,
      'west': 270,
      'northwest': 315
    },
    POINTS: {
      'point': 11.25 // One point = 11.25 degrees
    }
  }
}

const ELEVENLABS_API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
const ELEVENLABS_VOICE_ID = 'KdK3sZnIcumA6iSIe9KG'

export default function NavalHelmInterface() {
  const { theme } = useTheme()
  const [shipState, setShipState] = useState({
    rudder: 0,
    course: 0,
    speed: 0
  })

  const [isMuted, setIsMuted] = useState(false)
  const [lastCommand, setLastCommand] = useState('')
  const [commandLog, setCommandLog] = useState<string[]>([])
  const [screenResponse, setScreenResponse] = useState('')
  const [processingCommand, setProcessingCommand] = useState(false)

  const { 
    isListening, 
    transcript, 
    startListening, 
    stopListening, 
    error,
    setTranscript 
  } = useVoiceRecognition()
  const { toast } = useToast()

  const playAudioResponse = async (text: string) => {
    if (isMuted) return
    
    try {
      if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
        console.log('Using ElevenLabs with voice ID:', ELEVENLABS_VOICE_ID)
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_flash_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true
            }
          }),
        })

        if (!response.ok) {
          throw new Error(`ElevenLabs API error: ${response.status}`)
        }

        const audioBlob = await response.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        
        return new Promise((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl)
            resolve(true)
          }
          audio.onerror = reject
          audio.play().catch(reject)
        })
      } else {
        // Fallback to browser speech synthesis with improved settings
        return new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.rate = 0.95  // Slightly slower
          utterance.pitch = 1.1  // Slightly higher pitch
          utterance.volume = 1.0
          
          // Try to use a more natural voice if available
          const voices = window.speechSynthesis.getVoices()
          const preferredVoice = voices.find(voice => 
            voice.name.includes('Daniel') || 
            voice.name.includes('Premium') ||
            voice.name.includes('Natural')
          )
          if (preferredVoice) {
            utterance.voice = preferredVoice
          }
          
          utterance.onend = () => resolve(true)
          window.speechSynthesis.speak(utterance)
        })
      }
    } catch (error) {
      console.error('Audio playback error:', error)
      toast({
        title: "Audio Error",
        description: "Failed to play audio response",
        variant: "destructive",
      })
      return Promise.reject(error)
    }
  }

  const processCommand = useCallback(async (command: string) => {
    if (processingCommand) return
    
    setProcessingCommand(true)
    try {
      console.log('Raw command:', command)
      
      // Send command to LLM endpoint
      const response = await fetch('/api/process-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command,
          currentState: shipState
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to process command')
      }

      const result = await response.json()
      
      if (result.error) {
        throw new Error(result.error)
      }

      // Use the corrected command in the UI
      setLastCommand(result.correctedCommand || command)
      setCommandLog(prev => [result.correctedCommand || command, ...prev].slice(0, 5))

      // Update ship state with LLM-provided updates
      const newShipState = { ...shipState }
      if (result.stateUpdates) {
        if (result.stateUpdates.rudder !== null) {
          newShipState.rudder = result.stateUpdates.rudder
        }
        if (result.stateUpdates.course !== null) {
          newShipState.course = result.stateUpdates.course
        }
        if (result.stateUpdates.speed !== null) {
          newShipState.speed = result.stateUpdates.speed
        }
        setShipState(newShipState)
      }

      setScreenResponse(result.response)
      await playAudioResponse(result.response)

    } catch (error) {
      console.error('Command processing error:', error)
      toast({
        title: "Command Error",
        description: error instanceof Error ? error.message : "Failed to process command",
        variant: "destructive",
      })
    } finally {
      setProcessingCommand(false)
    }
  }, [playAudioResponse, shipState, toast])

  // Handle transcript updates
  useEffect(() => {
    if (!transcript || processingCommand) return
    
    const processTranscript = async () => {
      console.log('Processing transcript:', transcript)
      await processCommand(transcript)
      setTranscript('')
    }

    processTranscript()
  }, [transcript, processCommand, setTranscript])

  // Handle errors
  useEffect(() => {
    if (error) {
      console.error('Voice recognition error:', error)
      toast({
        title: "Voice Recognition Error",
        description: error,
        variant: "destructive",
      })
    }
  }, [error, toast])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev)
  }, [])

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 sm:p-6 ${theme.colors.background} ${theme.text.primary} rounded-lg shadow-lg relative`}>
      <ThemeSwitcher />
      <a 
        href="/theme-manager" 
        className={`absolute bottom-2 right-2 text-[10px] ${theme.text.muted} hover:${theme.text.accent} transition-colors duration-200`}
        title="Theme Manager"
      >
        ⚙
      </a>
      
      <h1 className={`${theme.fonts.display} text-2xl sm:text-3xl font-bold text-center mb-4 sm:mb-6 ${theme.text.primary}`}>
        Naval Ship's Helm Command Interface (Secure)
      </h1>
      
      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Ship Status - Left Column */}
        <div className="lg:col-span-8 grid grid-rows-[auto_1fr] gap-4 sm:gap-6">
          <Card className={`${theme.colors.cardBackground} ${theme.colors.cardBorder}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-lg sm:text-xl font-semibold flex justify-between items-center ${theme.text.primary}`}>
                Ship Status
                <span className={`text-xs sm:text-sm font-normal ${isListening ? theme.status.listening : theme.status.ready} px-2 sm:px-3 py-1 rounded`}>
                  {isListening ? 'Listening...' : 'Ready'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="min-w-[200px]">
                  <ShipStatus {...shipState} />
                </div>
                <div className="flex flex-col space-y-4">
                  {/* Engine Telegraph Display */}
                  <div className={`${theme.colors.cardBackground} p-3 sm:p-4 rounded-lg border ${theme.colors.cardBorder}`}>
                    <h3 className={`text-base sm:text-lg font-semibold mb-2 ${theme.text.primary}`}>Engine Telegraph</h3>
                    <div className="flex justify-between items-center text-sm">
                      <span className={theme.text.secondary}>Order:</span>
                      <span className={`${theme.fonts.mono} ${theme.indicators.speed} truncate ml-2`}>
                        {shipState.speed > 0 
                          ? `ALL AHEAD ${getSpeedText(shipState.speed)}`
                          : shipState.speed < 0 
                            ? `ALL ASTERN ${getSpeedText(Math.abs(shipState.speed))}`
                            : 'ALL STOP'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-sm">
                      <span className={theme.text.secondary}>Answering:</span>
                      <span className={`${theme.fonts.mono} ${theme.indicators.course} truncate ml-2`}>
                        {shipState.speed !== 0 ? 'ENGINES ANSWERING' : 'ENGINES STOPPED'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Rudder Angle Indicator */}
                  <div className={`${theme.colors.cardBackground} p-3 sm:p-4 rounded-lg border ${theme.colors.cardBorder}`}>
                    <h3 className={`text-base sm:text-lg font-semibold mb-2 ${theme.text.primary}`}>Rudder Angle</h3>
                    <div className={`relative h-8 ${theme.compass.background} rounded-full overflow-hidden`}>
                      <div 
                        className={`absolute top-0 bottom-0 ${theme.indicators.rudder} transition-all duration-500`}
                        style={{
                          left: '50%',
                          width: '4px',
                          transform: `translateX(-50%) rotate(${shipState.rudder}deg)`,
                          transformOrigin: 'bottom',
                        }}
                      />
                      <div className="absolute top-0 bottom-0 left-0 right-0 flex justify-between px-2 items-center text-xs">
                        <span className={theme.text.secondary}>35°L</span>
                        <span className={theme.text.muted}>|</span>
                        <span className={theme.text.secondary}>35°R</span>
                      </div>
                    </div>
                    <div className={`text-center mt-2 ${theme.fonts.mono} text-sm ${theme.text.primary}`}>
                      {Math.abs(shipState.rudder)}° {shipState.rudder < 0 ? 'LEFT' : shipState.rudder > 0 ? 'RIGHT' : 'AMIDSHIPS'}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Command Log */}
          <Card className={`${theme.colors.cardBackground} ${theme.colors.cardBorder}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-lg sm:text-xl font-semibold ${theme.text.primary}`}>Command Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`space-y-2 ${theme.fonts.mono} text-xs sm:text-sm`}>
                {commandLog.map((cmd, idx) => (
                  <div key={idx} className={`flex flex-col space-y-1 border-b ${theme.colors.cardBorder} pb-2`}>
                    <span className={`${theme.text.accent} break-words`}>CO: {cmd}</span>
                    <span className={`${theme.indicators.speed} pl-4 break-words`}>
                      Helm: {cmd.replace(/^helm,?\s*/i, '')}, aye aye
                    </span>
                    {idx === 0 && screenResponse && (
                      <span className={`${theme.indicators.course} pl-4 break-words`}>
                        Status: {screenResponse}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Compass and Controls */}
        <div className="lg:col-span-4 grid grid-rows-[auto_1fr] gap-4 sm:gap-6">
          <Card className={`${theme.colors.cardBackground} ${theme.colors.cardBorder}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-lg sm:text-xl font-semibold ${theme.text.primary}`}>Compass</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center">
                <div className="w-full max-w-[300px] mx-auto">
                  <CompassDisplay course={shipState.course} />
                </div>
                <div className={`mt-4 ${theme.fonts.mono} text-center`}>
                  <div className={`text-xl sm:text-2xl font-bold ${theme.text.primary}`}>
                    {shipState.course.toFixed(1)}°
                  </div>
                  <div className={`text-xs sm:text-sm ${theme.text.muted}`}>
                    {getCardinalDirection(shipState.course)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <Card className={`${theme.colors.cardBackground} ${theme.colors.cardBorder}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-lg sm:text-xl font-semibold ${theme.text.primary}`}>Controls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col space-y-4">
                <Button 
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onMouseLeave={stopListening}
                  variant={isListening ? "destructive" : "default"} 
                  size="lg"
                  className="w-full text-sm sm:text-base"
                >
                  {isListening ? <MicOff className="mr-2 h-4 w-4 sm:h-5 sm:w-5" /> : <Mic className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />}
                  {isListening ? 'Release to Process' : 'Press and Hold to Speak'}
                </Button>
                <Button 
                  onClick={toggleMute} 
                  variant="secondary" 
                  size="lg"
                  className={`w-full text-sm sm:text-base ${theme.colors.cardBackground} hover:opacity-80`}
                >
                  {isMuted ? <VolumeX className="mr-2 h-4 w-4 sm:h-5 sm:w-5" /> : <Volume2 className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />}
                  {isMuted ? 'Unmute Responses' : 'Mute Responses'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Version number */}
      <div className={`text-[10px] ${theme.text.muted} text-center mt-4`}>
        v0.2.0
      </div>
    </div>
  )
}

// Helper function to convert speed value to text
function getSpeedText(speed: number): string {
  if (speed >= 100) return 'FLANK'
  if (speed >= 90) return 'FULL'
  if (speed >= 75) return 'STANDARD'
  if (speed >= 67) return 'TWO THIRDS'
  if (speed >= 50) return 'HALF'
  if (speed >= 33) return 'ONE THIRD'
  if (speed >= 25) return 'SLOW'
  if (speed >= 10) return 'DEAD SLOW'
  return 'STOP'
}

// Helper function to get cardinal direction
function getCardinalDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 
                     'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(degrees / 22.5) % 16
  return directions[index]
}

