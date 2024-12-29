import { NextResponse } from 'next/server'
import { Groq } from 'groq-sdk'

// Naval command patterns and configurations
const NAVAL_PATTERNS = {
  RUDDER: {
    ANGLES: {
      HARD: 35,
      FULL: 30,
      STANDARD: 15,
      HALF: 10,
      SLIGHT: 5
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
  }
}

// Naval number pronunciation patterns
const NAVAL_NUMBERS = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'niner'
}

function formatNavalCourse(course: number): string {
  // Convert a number like 090 to "zero niner zero"
  return course.toString().padStart(3, '0').split('')
    .map(digit => NAVAL_NUMBERS[parseInt(digit)])
    .join(' ')
}

export async function POST(request: Request) {
  try {
    // Initialize Groq client inside the handler
    if (!process.env.GROQ_API_KEY) {
      console.error('Missing GROQ_API_KEY environment variable')
      return NextResponse.json(
        { error: 'Missing GROQ_API_KEY environment variable' },
        { status: 500 }
      )
    }

    const client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    })

    let body
    try {
      body = await request.json()
    } catch (error) {
      console.error('Error parsing request body:', error)
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { command, currentState } = body

    if (!command) {
      console.error('Command is required but was not provided')
      return NextResponse.json(
        { error: 'Command is required' },
        { status: 400 }
      )
    }

    console.log('Processing command:', command)
    console.log('Current state:', currentState)

    try {
      // First, correct any transcription errors and normalize the command format
      console.log('Sending command for correction:', command)
      const correctionCompletion = await client.chat.completions.create({
        messages: [
          { 
            role: 'system', 
            content: `You are a naval command correction system. Your job is to correct transcription errors and normalize naval helm commands to proper format.

Common transcription errors to fix:
- "home" → "helm"
- "love" → "left"
- "write" → "right"
- "hell", "help", "held" → "helm"
- "study", "stud" → "steady"
- "I had", "the head" → "ahead"
- "won" → "one"
- "tree" → "three"
- "ford" → "four"
- "1/3" → "one third"
- "2/3" → "two thirds"
- Single letters like "m", "h" → expand to proper word ("helm")
- Degrees symbol (°) → "degrees"

Number pronunciation:
- 0 → "zero"
- 1 → "one"
- 2 → "two"
- 3 → "three"
- 4 → "four"
- 5 → "five"
- 6 → "six"
- 7 → "seven"
- 8 → "eight"
- 9 → "niner"

Command format rules:
1. Always start with "Helm" if not present
2. For rudder commands: "Helm, [left/right] [X] degrees rudder"
3. For course commands: add "steady on course" and use proper number pronunciation
4. For speed commands: use "all ahead" or "all astern"
5. Combine multiple parts with commas

Examples:
- "m rudder left 15° stud" → "Helm, left 15 degrees rudder, steady"
- "helm write 20°" → "Helm, right 20 degrees rudder"
- "help all I had 1/3" → "Helm, all ahead one third"
- "steady on 090" → "steady on course zero niner zero"

Return only the corrected command text with no explanation.` 
          },
          { 
            role: 'user', 
            content: command 
          }
        ],
        model: 'llama-3.3-70b-specdec',
        max_tokens: 100,
        temperature: 0.1,
      })

      if (!correctionCompletion.choices?.[0]?.message?.content) {
        console.error('No correction response generated')
        throw new Error('No correction response generated')
      }

      const correctedCommand = correctionCompletion.choices[0].message.content.trim()
      console.log('Corrected command:', correctedCommand)

      // Now interpret the command and generate state updates
      console.log('Sending corrected command for interpretation:', correctedCommand)
      const interpretationCompletion = await client.chat.completions.create({
        messages: [
          { 
            role: 'system', 
            content: `You are a naval command interpreter. Return ONLY a JSON object with no explanation or text outside the JSON.

CRITICAL: Your response must be a single JSON object. No markdown, no explanation, no additional text.

Current ship state:
${JSON.stringify(currentState, null, 2)}

Rules:
1. Rudder angles:
   - Left rudder uses negative numbers (e.g., "left 20" = -20)
   - Right rudder uses positive numbers (e.g., "right 20" = +20)
   - Range: -35 to +35

2. Speed settings:
   ${JSON.stringify(NAVAL_PATTERNS.SPEED, null, 2)}

3. Course: 0-359 degrees

Required JSON format:
{
  "stateUpdates": {
    "rudder": number | null,  // -35 to +35, negative for left
    "course": number | null,  // 0-359
    "speed": number | null    // -100 to +110
  },
  "response": string         // Naval style response
}

Example for your exact command:
{"stateUpdates":{"rudder":-20,"speed":90,"course":180},"response":"left 20 degrees rudder, all ahead full, steady course one eight zero, aye aye"}

RETURN ONLY THE JSON OBJECT. NO OTHER TEXT.` 
          },
          { 
            role: 'user', 
            content: correctedCommand 
          }
        ],
        model: 'llama-3.3-70b-specdec',
        max_tokens: 250,
        temperature: 0.1,
      })

      if (!interpretationCompletion.choices?.[0]?.message?.content) {
        console.error('No interpretation response generated')
        throw new Error('No interpretation response generated')
      }

      let interpretation
      try {
        const rawResponse = interpretationCompletion.choices[0].message.content.trim()
        console.log('Raw interpretation response:', rawResponse)
        
        // Try to extract JSON if the response contains explanatory text
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          interpretation = JSON.parse(jsonMatch[0])
        } else {
          interpretation = JSON.parse(rawResponse)
        }
      } catch (error) {
        console.error('Error parsing interpretation response:', error)
        console.error('Raw response:', interpretationCompletion.choices[0].message.content)
        throw new Error('Invalid interpretation response format')
      }

      console.log('Parsed interpretation:', interpretation)

      // Validate the interpretation structure
      if (!interpretation.stateUpdates || !interpretation.response) {
        console.error('Invalid interpretation structure:', interpretation)
        throw new Error('Invalid interpretation structure')
      }

      // Format the course number in the response if it exists
      if (interpretation.stateUpdates?.course !== null) {
        const course = interpretation.stateUpdates.course
        interpretation.response = interpretation.response.replace(
          /course (\d{3})/,
          `course ${formatNavalCourse(course)}`
        )
      }

      // Add the original and corrected commands to the response
      return NextResponse.json({
        ...interpretation,
        originalCommand: command,
        correctedCommand: correctedCommand
      })
    } catch (error) {
      console.error('Error processing command:', error)
      return NextResponse.json(
        { error: `Failed to process command: ${error.message}` },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: `Internal server error: ${error.message}` },
      { status: 500 }
    )
  }
}

