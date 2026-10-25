"""Assessment battery v0.2: three versions tailored to the candidate's objective.

* junior   (track early_explorer, Class 8-10)   objective: choose a stream
* standard (track student, Class 11-12)         objective: choose a course and career
* adult    (track professional)                 objective: grow in or change a career

All text is original (not taken from any licensed test). Norms are placeholders
until real results build up or licensed norms are loaded through /admin/instruments.
Aptitude questions are written as (prompt, correct answer, distractors); the options
are shuffled with a fixed seed so the key position varies but every build is identical.
Numerical, series and perceptual questions are generated so their keys are computed.
"""
import random
from itertools import combinations

from instruments import AGREE, AGREE_JR, BANDS, LIKERT_JR, LIKERT_STD, RIASEC, SUBJECTS, likert_norms

VERSION = "0.2-original"
OBJECTIVE = {"junior": "stream choice", "standard": "course and career choice", "adult": "career growth or change"}

# ---------------------------------------------------------------- interests (RIASEC)

INTEREST = {
    "R": ["Repair a machine or gadget that has stopped working", "Build something with tools in a workshop",
          "Work outdoors on a construction or farm project", "Operate equipment or drive specialised vehicles",
          "Assemble furniture or electronics from instructions", "Look after animals on a farm or in a shelter",
          "Wire a circuit or install a solar panel", "Test how strong a bridge or structure is",
          "Cook for a large group in a professional kitchen", "Train hard for a physical or outdoor challenge"],
    "I": ["Work out why an experiment gave an unexpected result", "Read about new discoveries in science",
          "Solve a hard puzzle or maths problem", "Analyse data to find a hidden pattern",
          "Study how the human body fights disease", "Write code to model how something works",
          "Investigate the causes of climate change", "Find the fault in a complicated system",
          "Learn how markets or economies behave", "Research a question until you understand it fully"],
    "A": ["Design a poster, logo or app screen", "Write a story, poem or script",
          "Perform music, dance or drama", "Photograph or film something in an original way",
          "Decorate or redesign a room", "Create clothes, jewellery or accessories",
          "Compose a song or a piece of music", "Sketch characters for a comic or animation",
          "Plan how an exhibition or stage should look", "Edit a video so it tells a story"],
    "S": ["Teach a friend something they find difficult", "Help someone through a personal problem",
          "Volunteer for a community cause", "Care for people who are unwell",
          "Coach a sports team of younger students", "Listen to people and help them settle a disagreement",
          "Run a workshop that helps people learn a skill", "Support older people with daily tasks",
          "Guide new students or colleagues when they join", "Work on a programme that improves public health"],
    "E": ["Convince people to support an idea", "Start and run a small business",
          "Lead a team towards a target", "Negotiate a deal",
          "Pitch a product to a group of buyers", "Organise and promote a big event",
          "Raise money for a project from investors or sponsors", "Stand for election in a club or council",
          "Manage a shop or a branch and grow its sales", "Represent your group in a debate or meeting"],
    "C": ["Keep records organised and accurate", "Plan a budget and track spending",
          "Check a document carefully for errors", "Follow a clear process to get a task done",
          "Maintain a spreadsheet of stock or accounts", "Schedule shifts or timetables for a group",
          "File tax or official forms correctly", "Sort and label information in a database",
          "Audit a set of accounts for mistakes", "Prepare minutes and action lists after a meeting"],
}
INTEREST_JR = {
    "R": ["Fix a bicycle or a broken toy", "Build a model with your hands", "Grow plants in a garden",
          "Take apart an old gadget to see inside", "Help build a tree house or shelter", "Play an outdoor sport every day"],
    "I": ["Find out how a rocket flies", "Do a science experiment", "Solve a tricky riddle",
          "Watch a documentary about space or animals", "Use a microscope to look at tiny things", "Work out the answer to a hard maths puzzle"],
    "A": ["Draw, paint or make a comic", "Make up a story or song", "Act in a school play",
          "Design your own clothes or room", "Make a short video on a phone", "Play a musical instrument"],
    "S": ["Help a classmate with homework", "Look after a younger child", "Raise money for a good cause",
          "Make a new student feel welcome", "Help a friend who is upset", "Teach someone a game"],
    "E": ["Be the captain of a team", "Sell things at a school fair", "Give a speech in assembly",
          "Plan a class trip", "Convince friends to join your idea", "Run for class monitor"],
    "C": ["Arrange your books and notes neatly", "Keep score in a match", "Make a timetable and stick to it",
          "Keep track of your pocket money", "Sort a collection of stamps or cards", "Check your work for mistakes before handing it in"],
}
INTEREST_ADULT = {
    "R": ["Install, repair or maintain equipment", "Work on a site rather than at a desk", "Build or test physical prototypes",
          "Run machinery or vehicles safely", "Work with tools, materials or hardware", "Work outdoors or in the field",
          "Set up and troubleshoot networks or devices", "Inspect sites, plants or machines for safety"],
    "I": ["Analyse data to answer a business or research question", "Diagnose the root cause of a complex problem", "Keep up with research in your field",
          "Build models or simulations", "Design and run experiments or A/B tests", "Work through technical documentation in depth",
          "Evaluate evidence before a decision is made", "Learn a new technical skill from scratch"],
    "A": ["Create designs, content or campaigns", "Write articles, scripts or copy", "Shape the look and feel of a product",
          "Perform, present or record creative work", "Come up with original concepts for a brief", "Tell a brand or product story",
          "Work on photography, video or illustration", "Improvise when there is no fixed method"],
    "S": ["Train, coach or mentor people", "Counsel or support people through difficulties", "Work in health, education or social care",
          "Resolve conflicts between people", "Help customers solve their problems", "Run programmes that develop people",
          "Advocate for people who are underserved", "Facilitate group discussions or workshops"],
    "E": ["Lead a team to hit targets", "Sell or pitch to clients", "Start or grow a business",
          "Negotiate contracts or partnerships", "Set strategy and make the final call", "Persuade senior people to back a plan",
          "Take commercial risks for a bigger reward", "Represent the organisation in public"],
    "C": ["Keep accounts, records or registers accurate", "Run processes and make sure they are followed", "Prepare reports and reconciliations",
          "Check compliance with rules and policies", "Plan schedules, budgets and resources", "Manage data quality in systems",
          "Draft precise procedures or checklists", "Track deadlines and follow-ups for a team"],
}

# ---------------------------------------------------------------- personality (Big Five)

BIGFIVE_STD = {  # (text, reverse); 12 per domain
    "O": [("I enjoy thinking about new ideas", False), ("I like art, music or literature", False), ("I prefer routines to new experiences", True),
          ("I am curious about many things", False), ("I find abstract ideas boring", True), ("I enjoy imagining possibilities", False),
          ("I like to try food I have never eaten", False), ("I rarely notice beauty around me", True), ("I enjoy discussing big questions", False),
          ("I stick to what I already know", True), ("I like learning how other cultures live", False), ("I am not interested in theories", True)],
    "C": [("I keep my things organised", False), ("I finish what I start", False), ("I often leave tasks to the last minute", True),
          ("I plan ahead", False), ("I can be careless", True), ("I work steadily until a job is done", False),
          ("I pay attention to details", False), ("I get distracted easily", True), ("I keep my promises", False),
          ("I find it hard to follow a schedule", True), ("I prepare well before exams or deadlines", False), ("I leave my work half done", True)],
    "E": [("I am outgoing and sociable", False), ("I feel energised around people", False), ("I tend to be quiet in groups", True),
          ("I start conversations easily", False), ("I prefer to stay in the background", True), ("I am full of energy", False),
          ("I enjoy being the centre of attention", False), ("I find big gatherings tiring", True), ("I speak up when I have an opinion", False),
          ("I keep my thoughts to myself", True), ("I make friends quickly", False), ("I avoid leading a group", True)],
    "A": [("I am considerate of others' feelings", False), ("I trust people easily", False), ("I can be cold or distant", True),
          ("I like to cooperate", False), ("I start arguments", True), ("I forgive easily", False),
          ("I go out of my way to help others", False), ("I can be critical of others", True), ("I respect other people's views", False),
          ("I put my needs before everyone else's", True), ("I am patient with people", False), ("I hold grudges", True)],
    "N": [("I worry a lot", False), ("I get stressed easily", False), ("I stay calm under pressure", True),
          ("My mood changes often", False), ("I rarely feel anxious", True), ("I get upset easily", False),
          ("I feel nervous before tests or reviews", False), ("I bounce back quickly from setbacks", True), ("Small problems can ruin my day", False),
          ("I am mostly relaxed", True), ("I often feel low", False), ("I handle criticism well", True)],
}
BIGFIVE_JR = {  # 6 per domain, simpler wording
    "O": [("I like trying new things", False), ("I enjoy making up stories or games", False), ("I like doing things the same way every time", True),
          ("I ask lots of questions", False), ("I find museums and art boring", True), ("I like learning about other places", False)],
    "C": [("I keep my school bag tidy", False), ("I finish my homework on time", False), ("I often forget things I need", True),
          ("I plan what I will do", False), ("I rush and make silly mistakes", True), ("I keep going until a job is done", False)],
    "E": [("I like being with lots of people", False), ("I talk a lot in class", False), ("I am shy with new people", True),
          ("I like to perform in front of others", False), ("I prefer playing alone", True), ("I have lots of energy", False)],
    "A": [("I care how my friends feel", False), ("I share my things", False), ("I tease others", True),
          ("I like working in a team", False), ("I fight with others", True), ("I say sorry when I am wrong", False)],
    "N": [("I worry a lot", False), ("I get upset easily", False), ("I stay calm when things go wrong", True),
          ("I feel nervous before tests", False), ("I am mostly cheerful", True), ("My feelings get hurt easily", False)],
}
SD_STD = ["I have never been annoyed with anyone", "I always keep every promise I make",
          "I have never taken anything that was not mine", "I have never said something I regretted"]
SD_JR = ["I have never been angry with anyone", "I always do what I am told", "I have never told a lie"]

# ---------------------------------------------------------------- work style (R-A-P-D tetrads)

WS_STD = [
    ("Driven to win", "Lively with people", "Calm and patient", "Careful and exact"),
    ("Direct", "Persuasive", "Loyal", "Systematic"),
    ("Takes charge", "Enthusiastic", "Easy-going", "Follows the rules"),
    ("Competitive", "Talkative", "Good listener", "Thorough"),
    ("Bold", "Optimistic", "Even-tempered", "Accurate"),
    ("Decisive", "Inspiring", "Dependable", "Analytical"),
    ("Independent", "Sociable", "Consistent", "Precise"),
    ("Forceful", "Charming", "Steady", "Cautious"),
    ("Daring", "Expressive", "Supportive", "Orderly"),
    ("Restless for results", "Warm", "Unhurried", "Detail-minded"),
    ("Firm", "Playful", "Cooperative", "Logical"),
    ("Ambitious", "Friendly", "Patient", "Diligent"),
    ("Goal-focused", "Popular", "Reliable", "Exacting"),
    ("Strong-willed", "Spontaneous", "Peaceful", "Reserved"),
    ("Quick to act", "Good at networking", "Good team player", "Careful planner"),
    ("Likes control", "Likes attention", "Likes harmony", "Likes accuracy"),
    ("Challenges others", "Encourages others", "Accommodates others", "Questions others"),
    ("Pushes for change", "Sells the change", "Eases the change", "Checks the change"),
    ("Outspoken", "Animated", "Modest", "Factual"),
    ("Takes risks", "Trusts people", "Avoids conflict", "Avoids mistakes"),
    ("Tough-minded", "Light-hearted", "Kind-hearted", "Level-headed"),
    ("Sets the pace", "Lifts the mood", "Keeps the peace", "Keeps the standard"),
    ("Impatient with delay", "Impatient with routine", "Uneasy with sudden change", "Uneasy with vague plans"),
    ("Wants results", "Wants recognition", "Wants security", "Wants correctness"),
]
WS_JR = [
    ("I like to win", "I love chatting with friends", "I stay calm", "I like things neat"),
    ("I say what I think", "I cheer people up", "I'm a loyal friend", "I check my work"),
    ("I like to be the leader", "I'm full of energy", "I go with the flow", "I follow instructions"),
    ("I'm brave", "I'm fun", "I'm patient", "I'm careful"),
    ("I decide fast", "I get people excited", "People can count on me", "I think things through"),
    ("I do things my way", "I make friends easily", "I like routines", "I like getting it exactly right"),
    ("I push hard", "I make people laugh", "I help others", "I keep things organised"),
    ("I like challenges", "I like parties", "I like quiet time", "I like rules that make sense"),
    ("I like to be first", "I like to be noticed", "I like everyone to get along", "I like to be right"),
    ("I try new things", "I tell good stories", "I listen well", "I ask how things work"),
    ("I don't give up", "I'm cheerful", "I'm gentle", "I'm neat"),
    ("I want to win the game", "I want everyone to have fun", "I want no one to fight", "I want to play by the rules"),
]

# ---------------------------------------------------------------- values, learning, adult scales

VALUES_STD = ["Achievement", "Security", "Creativity", "Helping others", "Independence",
              "Recognition", "Variety", "Work-life balance", "Learning", "Leadership"]
VALUES_JR = ["Being kind", "Being creative", "Winning", "Learning new things", "Making my family proud", "Having freedom"]

LEARNING = {
    "visual": ["I understand best from diagrams and charts", "I remember faces better than names", "I like colour-coding my notes",
               "I picture the page in my head when I revise"],
    "auditory": ["I learn well by listening to explanations", "I remember things I have discussed aloud", "I like podcasts or recorded lectures",
                 "Reading aloud helps me remember"],
    "reading": ["I like reading the textbook before class", "Writing notes helps me remember", "I prefer written instructions",
                "I rewrite my notes to learn them"],
    "kinesthetic": ["I learn best by doing", "I need to move around while studying", "I like hands-on experiments",
                    "I understand a machine once I have used it"],
}
LEARNING_JR = {
    "visual": ["Pictures help me learn", "I like drawing mind-maps", "I remember what I see", "Videos help me understand"],
    "auditory": ["I learn when someone explains out loud", "I remember songs easily", "I like talking about what I learned", "I say things aloud to remember them"],
    "reading": ["I like reading on my own", "Writing things down helps me", "I like lists", "I like reading the instructions first"],
    "kinesthetic": ["I learn by trying things", "I can't sit still for long", "I like building models", "I count on my fingers or use objects"],
}
CAREER_ANCHORS = {  # what a person will not give up in a career; 4 statements each
    "technical": ["I want to become the go-to expert in my field", "I would rather deepen my skill than manage people",
                  "Being excellent at my craft matters more than my title", "I would turn down a promotion that took me away from my specialism"],
    "managerial": ["I want to be responsible for a whole team or unit", "I enjoy bringing different functions together to deliver results",
                   "I measure success by the size of what I lead", "I want to rise to a senior general management role"],
    "autonomy": ["I want to decide how and when I do my work", "Rules and close supervision frustrate me",
                 "I would accept less money for more freedom", "I prefer consulting, freelancing or independent roles"],
    "security": ["A stable job matters more to me than a fast rise", "I value predictable income and benefits",
                 "I prefer organisations that rarely lay people off", "I would avoid a role with an uncertain future"],
    "entrepreneurial": ["I want to build something that is my own", "I keep spotting ideas for new businesses",
                        "I would risk a steady salary to start a venture", "Creating a product or company excites me most"],
    "service": ["I want my work to make the world better", "I would choose a meaningful role over a better-paid one",
                "Helping people or a cause is central to my career", "I could not stay in work that conflicts with my values"],
    "challenge": ["I seek out problems others find impossible", "I get bored once a job becomes easy",
                  "Competing against strong rivals motivates me", "I want each role to be harder than the last"],
    "lifestyle": ["My career must fit around my family and personal life", "I would not relocate if it hurt my family life",
                  "Flexible hours matter more to me than a bigger role", "I want work that leaves energy for life outside it"],
}
ADAPTABILITY = {  # readiness to manage career change; 6 statements each
    "concern": ["I think about what my career will look like in five years", "I prepare now for the future I want",
                "I know which choices I must make soon", "I plan how to reach my career goals",
                "I keep track of how my industry is changing", "I set aside time to think about my next move"],
    "control": ["I take responsibility for my career decisions", "I make decisions without waiting for others",
                "I stand up for what I believe my career needs", "I rely on myself to find opportunities",
                "I do what is right for my career even when it is hard", "I follow through on the plans I make"],
    "curiosity": ["I explore options before choosing", "I look for chances to try new kinds of work",
                  "I ask people in other roles what their work is like", "I investigate before I take a decision",
                  "I am open to roles I had not considered", "I try new ways of doing my job"],
    "confidence": ["I learn new skills quickly", "I can overcome obstacles at work",
                   "I perform well under new conditions", "I solve problems I have not met before",
                   "I can make a career move work", "I believe I can succeed in a different role"],
}

# ---------------------------------------------------------------- aptitude: hand-written

VERBAL = {
    "junior": [
        ("HAPPY means nearly the same as …", "Glad", ["Sad", "Angry", "Tired"]),
        ("Which word means the opposite of ANCIENT?", "Modern", ["Old", "Huge", "Quiet"]),
        ("BIRD is to NEST as BEE is to …", "Hive", ["Honey", "Flower", "Wing"]),
        ("Which word is spelled correctly?", "Receive", ["Recieve", "Receeve", "Riceive"]),
        ("Which word does not belong: apple, mango, carrot, banana?", "Carrot", ["Apple", "Mango", "Banana"]),
        ("Fill the gap: She was so tired that she ___ asleep at once.", "fell", ["fall", "falls", "falling"]),
        ("BRAVE means nearly the same as …", "Courageous", ["Scared", "Lazy", "Polite"]),
        ("PEN is to WRITE as KNIFE is to …", "Cut", ["Sharp", "Kitchen", "Fork"]),
    ],
    "standard": [
        ("Choose the word closest in meaning to METICULOUS.", "Precise", ["Careless", "Quick", "Loud"]),
        ("BOOK is to READ as FORK is to …", "Eat", ["Kitchen", "Metal", "Spoon"]),
        ("Choose the word opposite in meaning to SCARCE.", "Plentiful", ["Rare", "Small", "Hidden"]),
        ("Which sentence is correct?", "Each of the students has a book.",
         ["Each of the students have a book.", "Each of the student have a book.", "Each students has a book."]),
        ("Choose the word closest in meaning to CANDID.", "Frank", ["Secretive", "Sweet", "Careful"]),
        ("Choose the word opposite in meaning to EXPAND.", "Contract", ["Grow", "Widen", "Extend"]),
        ("DOCTOR is to HOSPITAL as TEACHER is to …", "School", ["Student", "Book", "Lesson"]),
        ("'Most students who revised daily scored above 70.' Which statement is best supported?",
         "Daily revision went with higher scores for most of these students",
         ["Every student who revised daily scored above 70", "Students who did not revise failed", "Revision has no effect on scores"]),
    ],
    "adult": [
        ("Choose the word closest in meaning to PRAGMATIC.", "Practical", ["Idealistic", "Talkative", "Stubborn"]),
        ("Choose the word opposite in meaning to TRANSPARENT.", "Opaque", ["Clear", "Honest", "Thin"]),
        ("AUTHOR is to NOVEL as COMPOSER is to …", "Symphony", ["Piano", "Orchestra", "Singer"]),
        ("Which sentence is correct?", "Between you and me, the plan needs work.",
         ["Between you and I, the plan needs work.", "Between yourself and I, the plan needs work.", "Among you and I, the plan needs work."]),
        ("The report was so ___ that nobody could find the key point.", "verbose", ["concise", "brief", "accurate"]),
        ("Choose the word closest in meaning to MITIGATE.", "Lessen", ["Worsen", "Ignore", "Measure"]),
        ("'All shortlisted vendors are ISO certified. Vendor X is not ISO certified.' What follows?", "Vendor X is not shortlisted",
         ["Vendor X is shortlisted", "Some shortlisted vendors are not certified", "Nothing follows"]),
        ("Choose the word opposite in meaning to FRUGAL.", "Extravagant", ["Thrifty", "Careful", "Poor"]),
    ],
}
SPATIAL = {
    "junior": [
        ("How many edges does a cube have?", "12", ["6", "8", "10"]),
        ("You face east and turn left. Which way are you facing?", "North", ["South", "West", "East"]),
        ("You face north and turn right twice. Which way are you facing?", "South", ["North", "East", "West"]),
        ("A square sheet is folded in half, then in half again. One hole is punched through all the layers. How many holes are there when it is opened?",
         "4", ["1", "2", "8"]),
        ("Which capital letter looks the same in a mirror held beside it?", "A", ["B", "R", "S"]),
        ("If you rotate the letter 'b' half a turn (upside down), which letter do you see?", "q", ["d", "p", "b"]),
        ("How many faces does a pyramid with a square base have?", "5", ["4", "6", "8"]),
        ("The hour hand points at 3. After a quarter turn clockwise, where does it point?", "6", ["9", "12", "4"]),
    ],
    "standard": [
        ("A cube painted on all faces is cut into 27 equal small cubes. How many small cubes have exactly two painted faces?", "12", ["6", "8", "18"]),
        ("The same 27 small cubes: how many have no painted face?", "1", ["0", "6", "8"]),
        ("You face north, turn 90° right, then turn 180°. Which way are you facing?", "West", ["North", "East", "South"]),
        ("Opposite faces of a standard die add up to 7. If the top shows 2, what is on the bottom?", "5", ["3", "4", "6"]),
        ("A clock shows 3:00. What time does its mirror image show?", "9:00", ["3:00", "6:00", "12:00"]),
        ("What is the angle between the hour and minute hands at 3:00?", "90°", ["45°", "60°", "120°"]),
        ("How many faces does a hexagonal prism have?", "8", ["6", "7", "12"]),
        ("A sheet is folded in half three times and one hole is punched through all layers. How many holes appear when it is opened?", "8", ["3", "6", "9"]),
    ],
    "adult": [
        ("A 4×4×4 cube painted on all faces is cut into 64 unit cubes. How many have exactly three painted faces?", "8", ["4", "12", "24"]),
        ("The same 64 unit cubes: how many have exactly one painted face?", "24", ["8", "16", "36"]),
        ("You walk 3 km north, then 4 km east. How far are you from the start in a straight line?", "5 km", ["6 km", "7 km", "1 km"]),
        ("You face south and turn 270° clockwise. Which way are you facing?", "East", ["North", "South", "West"]),
        ("What is the angle between the clock hands at 6:00?", "180°", ["90°", "120°", "0°"]),
        ("How many edges does a triangular prism have?", "9", ["6", "12", "5"]),
        ("On a map 1 cm stands for 5 km. Two towns are 7.5 cm apart on the map. How far apart are they?", "37.5 km", ["35.5 km", "75 km", "12.5 km"]),
        ("A rectangle is rolled up so that two opposite edges meet. Which shape does it make?", "Cylinder", ["Cone", "Sphere", "Pyramid"]),
    ],
}
MECHANICAL = {
    "junior": [
        ("Two gears touch. The first turns clockwise. Which way does the second turn?", "Anticlockwise", ["Clockwise", "It does not turn", "Both ways at once"]),
        ("Which needs less force to get a heavy box onto a truck?", "Pushing it up a long ramp", ["Lifting it straight up", "Both need the same force", "Neither works"]),
        ("To balance a seesaw with a lighter child, where should the heavier child sit?", "Closer to the middle", ["Further from the middle", "At the very end", "It cannot balance"]),
        ("Which of these is a lever?", "A bottle opener", ["A nail", "A rope", "A glass"]),
        ("Which of these sinks in water?", "A steel nail", ["A wooden log", "An empty plastic bottle", "A ping-pong ball"]),
        ("Why do tyres have grooves?", "To grip the road better", ["To look nice", "To make them lighter", "To make them louder"]),
        ("A big gear with 20 teeth turns a small gear with 10 teeth. When the big gear turns once, the small gear turns …", "Twice", ["Half a turn", "Once", "Four times"]),
        ("Which falls faster through the air?", "A sheet of paper crumpled into a ball", ["The same sheet kept flat", "Both fall at the same speed", "Neither falls"]),
    ],
    "standard": [
        ("Three gears are in a line, each touching the next. The first turns clockwise. Which way does the third turn?", "Clockwise", ["Anticlockwise", "It does not turn", "It depends on its size"]),
        ("To lift a heavy rock with a crowbar using the least effort, where should the pivot go?", "Close to the rock", ["Close to your hands", "Exactly in the middle", "It does not matter"]),
        ("A single movable pulley lifts a 100 N load. Ignoring friction, about how much effort is needed?", "50 N", ["100 N", "200 N", "25 N"]),
        ("A 40-tooth gear drives a 10-tooth gear. If the large gear makes 3 turns, how many does the small gear make?", "12", ["3", "4", "7.5"]),
        ("Why does a sharp knife cut better than a blunt one?", "The same force acts on a smaller area, so the pressure is higher",
         ["It is heavier", "It has more friction", "It is made of stronger metal"]),
        ("A small force on the small piston of a hydraulic jack lifts a car. Why?", "The liquid passes the pressure to a larger piston, which multiplies the force",
         ["The liquid is lighter than air", "The car becomes lighter", "The small piston stores energy"]),
        ("Two pulleys are joined by a crossed belt. If one turns clockwise, the other turns …", "Anticlockwise", ["Clockwise", "Not at all", "Clockwise but faster"]),
        ("A ball rolls off a table at the moment an identical ball is dropped from the same height. Ignoring air, which lands first?", "They land together",
         ["The rolling ball", "The dropped ball", "It depends on the table"]),
    ],
}
LOGICAL = {
    "standard": [
        ("All roses are flowers. Some flowers fade quickly. Which must be true?", "None of these must be true",
         ["All roses fade quickly", "Some roses fade quickly", "No rose fades quickly"]),
        ("A is B's brother. B is C's mother. How is A related to C?", "Uncle", ["Father", "Brother", "Cousin"]),
        ("In a row, P is left of Q, Q is left of R, and S is right of R. Who is second from the left?", "Q", ["P", "R", "S"]),
        ("All Bloops are Razzies and all Razzies are Lazzies. So all Bloops are …", "Lazzies", ["not Lazzies", "only sometimes Lazzies", "impossible to say"]),
        ("'If it rains, the match is cancelled.' The match was not cancelled. What follows?", "It did not rain",
         ["It rained", "The match was played indoors", "Nothing can be concluded"]),
        ("Today is Wednesday. What day will it be 10 days from now?", "Saturday", ["Friday", "Sunday", "Thursday"]),
        ("Ravi is taller than Sita. Sita is taller than Amit. Who is the shortest?", "Amit", ["Ravi", "Sita", "Cannot tell"]),
        ("Task B must come after A, C after B, and D before A. Which task comes first?", "D", ["A", "B", "C"]),
    ],
    "adult": [
        ("All managers in the firm attended the training. Neha did not attend. Which must be true?", "Neha is not a manager in the firm",
         ["Neha is a manager", "Some managers skipped the training", "Nothing follows"]),
        ("Every project that overruns its budget is reviewed. Project K was reviewed. What follows?", "We cannot tell whether K overran its budget",
         ["K overran its budget", "K stayed within budget", "Only overrunning projects are reviewed, so K overran"]),
        ("Anil's father is the only son of Mohan's father. How is Mohan related to Anil?", "Father", ["Uncle", "Grandfather", "Brother"]),
        ("Some analysts are engineers. All engineers are graduates. Which must be true?", "Some analysts are graduates",
         ["All analysts are graduates", "All graduates are engineers", "No analyst is a graduate"]),
        ("What comes next: Monday, Wednesday, Saturday, Wednesday, …", "Monday", ["Sunday", "Tuesday", "Thursday"]),
        ("'Some A are B' is true. Which statement could still be false?", "All A are B", ["Some B are A", "At least one A is B", "It is not true that no A is B"]),
        ("If the code for 1234 is 4321 and for 5678 is 8765, what is the code for 2468?", "8642", ["2468", "6824", "4286"]),
        ("Four tasks: B after A, C after B, and D before A. Which order is correct?", "D, A, B, C", ["A, B, C, D", "D, B, A, C", "A, D, B, C"]),
    ],
}

# ---------------------------------------------------------------- aptitude: generated


def _rupees(x):
    return f"₹{x:,}"


def numerical(variant, rng):
    """(prompt, correct, distractors) with computed keys."""
    qs = []
    if variant == "junior":
        p, n = rng.choice([6, 7, 8, 9]), rng.choice([6, 7, 8])
        qs.append((f"A pencil costs ₹{p}. How much do {n} pencils cost?", _rupees(p * n), [_rupees(p * n + p), _rupees(p * n - p), _rupees(p + n)]))
        have, spend = 100, rng.choice([35, 45, 55])
        qs.append((f"Riya has ₹{have} and spends ₹{spend}. How much is left?", _rupees(have - spend), [_rupees(have - spend + 10), _rupees(have - spend - 10), _rupees(have - spend + 5)]))
        qs.append(("What is half of three quarters?", "3/8", ["1/2", "3/4", "1/4"]))
        total, k = rng.choice([24, 36, 48]), rng.choice([3, 4])
        qs.append((f"{total} sweets are shared equally among {k} friends. How many does each get?", str(total // k), [str(total // k + 2), str(total // k - 2), str(total - k)]))
        l, w = rng.choice([8, 9, 12]), rng.choice([4, 5, 6])
        qs.append((f"A rectangle is {l} cm long and {w} cm wide. What is its perimeter?", f"{2 * (l + w)} cm", [f"{l * w} cm", f"{l + w} cm", f"{2 * l + w} cm"]))
        a, b, c = 12, 15, rng.choice([18, 21])
        qs.append((f"What is the average of {a}, {b} and {c}?", str((a + b + c) // 3) if (a + b + c) % 3 == 0 else f"{(a + b + c) / 3:g}",
                   [str(a + b + c), f"{(a + b + c) / 3 + 2:g}", f"{(a + b + c) / 3 - 1:g}"]))
        price = rng.choice([200, 300, 400])
        qs.append((f"A toy costs ₹{price}. It is sold at 25% off. What is the new price?", _rupees(price * 3 // 4), [_rupees(price // 4), _rupees(price - 25), _rupees(price * 5 // 4)]))
        start, mins = rng.choice([(9, 45), (10, 35)]), 50
        h, m = start
        end_h, end_m = h + (m + mins) // 60, (m + mins) % 60
        qs.append((f"A class starts at {h}:{m:02d} and lasts {mins} minutes. When does it end?", f"{end_h}:{end_m:02d}",
                   [f"{h}:{(m + 5) % 60:02d}", f"{end_h}:{(end_m + 10) % 60:02d}", f"{end_h + 1}:{end_m:02d}"]))
    elif variant == "standard":
        before = rng.choice([1000, 1200, 1500])
        qs.append((f"A shirt costs {_rupees(before * 4 // 5)} after a 20% discount. What was the price before the discount?", _rupees(before),
                   [_rupees(before * 4 // 5 * 6 // 5), _rupees(before + 200), _rupees(before * 4 // 5 - 160)]))
        dist, t = rng.choice([(180, 2.5), (150, 2.5), (210, 3.5)])
        qs.append((f"A train covers {dist} km in {t:g} hours. What is its average speed?", f"{dist / t:g} km/h",
                   [f"{dist / t + 6:g} km/h", f"{dist / t - 12:g} km/h", f"{dist / (t + 0.5):g} km/h"]))
        pr, r, y = rng.choice([5000, 8000]), rng.choice([5, 8]), 3
        si = pr * r * y // 100
        qs.append((f"What is the simple interest on {_rupees(pr)} at {r}% a year for {y} years?", _rupees(si), [_rupees(si // y), _rupees(si + pr * r // 100), _rupees(pr + si)]))
        x, y2 = rng.choice([(15, 240), (12, 250)])
        ans = x * y2 // 100 + 25 * 120 // 100
        qs.append((f"What is {x}% of {y2} plus 25% of 120?", str(ans), [str(ans + 6), str(ans - 6), str(ans + 12)]))
        a, b, tot = 2, 3, rng.choice([500, 750])
        qs.append((f"{_rupees(tot)} is shared between Asha and Ben in the ratio {a}:{b}. How much does Ben get?", _rupees(tot * b // (a + b)),
                   [_rupees(tot * a // (a + b)), _rupees(tot // 2), _rupees(tot * b // (a + b) + 50)]))
        da, db = rng.choice([(6, 12), (10, 15)])
        together = da * db / (da + db)
        qs.append((f"A can finish a job in {da} days and B in {db} days. How long do they take working together?", f"{together:g} days",
                   [f"{(da + db) / 2:g} days", f"{da + db} days", f"{together + 1:g} days"]))
        cost, sell = rng.choice([(400, 500), (800, 1000)])
        qs.append((f"An item bought for {_rupees(cost)} is sold for {_rupees(sell)}. What is the profit percentage?", "25%", ["20%", "30%", "15%"]))
        m = [62, 74, 81, rng.choice([67, 71])]
        avg = sum(m) / 4
        qs.append((f"Marks in four tests are {', '.join(map(str, m))}. What is the average?", f"{avg:g}", [f"{avg + 2:g}", f"{avg - 2:g}", f"{sum(m[:3]) / 3:.1f}"]))
    else:
        base, g = rng.choice([(50, 10), (80, 10)])
        two = base * (100 + g) ** 2 / 10000
        qs.append((f"Revenue of ₹{base} lakh grows {g}% a year for two years. What is it after two years?", f"₹{two:g} lakh",
                   [f"₹{base * (100 + 2 * g) / 100:g} lakh", f"₹{base * (100 + g) / 100:g} lakh", f"₹{two + 1:g} lakh"]))
        qs.append(("Sales rise 10% in one quarter and fall 10% the next. Compared with the start, sales are …", "1% lower", ["The same", "1% higher", "10% lower"]))
        fixed, margin = rng.choice([(60000, 150), (90000, 300)])
        qs.append((f"Fixed costs are {_rupees(fixed)} a month and each unit earns {_rupees(margin)} after variable costs. How many units must be sold to break even?",
                   f"{fixed // margin:,}", [f"{fixed // margin + 100:,}", f"{fixed // (margin * 2):,}", f"{fixed // margin * 2:,}"]))
        qs.append(("A team of 6 averages 40 tickets a day and a team of 4 averages 50. What is the combined average per person?", "44", ["45", "42", "46"]))
        qs.append(("You drive to a site at 60 km/h and back by the same road at 40 km/h. What is the average speed for the round trip?", "48 km/h", ["50 km/h", "45 km/h", "52 km/h"]))
        cost = rng.choice([1200, 1600])
        qs.append((f"A product costs {_rupees(cost)} to make and is priced with a 25% markup on cost. What is the price?", _rupees(cost * 5 // 4),
                   [_rupees(cost * 4 // 3), _rupees(cost + 25), _rupees(cost * 3 // 4)]))
        total, it = 40, rng.choice([12, 14])
        qs.append((f"A ₹{total} lakh budget includes ₹{it} lakh for IT. What share of the budget is IT?", f"{it * 100 / total:g}%",
                   [f"{it * 100 / total + 5:g}%", f"{it:g}%", f"{(total - it) * 100 / total:g}%"]))
        old, new = rng.choice([(80, 92), (50, 58)])
        qs.append((f"A metric moves from {old} to {new}. What is the percentage increase?", f"{(new - old) * 100 / old:g}%",
                   [f"{new - old}%", f"{(new - old) * 100 / new:.1f}%", f"{(new - old) * 100 / old + 5:g}%"]))
    return qs


def _series(kind, rng):
    if kind == "arith":
        a, d = rng.randint(2, 9), rng.randint(3, 7)
        s = [a + d * i for i in range(6)]
    elif kind == "geom":
        a, r = rng.randint(2, 4), rng.choice([2, 3])
        s = [a * r ** i for i in range(6)]
    elif kind == "square":
        o = rng.randint(1, 3)
        s = [(i + o) ** 2 for i in range(6)]
    elif kind == "growing":
        a, d = rng.randint(1, 5), rng.randint(1, 3)
        s, step = [a], d
        for _ in range(5):
            s.append(s[-1] + step)
            step += d
    elif kind == "fib":
        a, b = rng.randint(1, 4), rng.randint(2, 5)
        s = [a, b]
        while len(s) < 6:
            s.append(s[-1] + s[-2])
    elif kind == "alternate":
        a, d1, d2 = rng.randint(10, 20), rng.randint(4, 7), rng.randint(1, 3)
        s = [a]
        for i in range(5):
            s.append(s[-1] + (d1 if i % 2 == 0 else -d2))
    elif kind == "times_plus":
        a, m, c = rng.randint(1, 3), 2, rng.randint(1, 3)
        s = [a]
        for _ in range(5):
            s.append(s[-1] * m + c)
    else:  # letters
        start, d = rng.randint(0, 6), rng.choice([2, 3])
        letters = [chr(65 + start + d * i) for i in range(6)]
        ans = letters[-1]
        wrong = sorted({chr(65 + start + d * 5 + k) for k in (-1, 1, 2)} - {ans})
        return f"What comes next: {', '.join(letters[:-1])}, …", ans, wrong[:3]
    ans = s[-1]
    diff = s[-1] - s[-2]
    wrong = []
    for w in (ans + 1, ans - 1, ans + diff, s[-2] + (s[-2] - s[-3]), ans + 2, ans - 2):
        if w != ans and w not in wrong and w > 0:
            wrong.append(w)
    return f"What comes next: {', '.join(map(str, s[:-1]))}, …", str(ans), [str(w) for w in wrong[:3]]


def abstract(variant, rng):
    kinds = {"junior": ["arith", "arith", "square", "geom", "letters", "growing", "alternate", "letters"],
             "standard": ["growing", "geom", "square", "letters", "fib", "alternate", "times_plus", "arith"],
             "adult": ["growing", "fib", "times_plus", "alternate", "letters", "geom", "square", "times_plus"]}[variant]
    qs = [_series(k, rng) for k in kinds]
    odd = {"junior": ("Which one does not belong: circle, square, triangle, cube?", "Cube", ["Circle", "Square", "Triangle"]),
           "standard": ("Which number does not belong: 121, 144, 169, 196, 210?", "210", ["144", "169", "196"]),
           "adult": ("Which number does not belong: 2, 3, 5, 7, 9, 11?", "9", ["2", "7", "11"])}[variant]
    qs[-1] = odd
    return qs


def _codes(rng, length):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(rng.choice(alphabet) for _ in range(length))


def _mutate(s, rng):
    i = rng.randrange(len(s))
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".replace(s[i], "")
    return s[:i] + rng.choice(alphabet) + s[i + 1:]


def perceptual(variant, rng):
    """Speed and accuracy: spot the identical pair, or count a symbol."""
    length = 5 if variant == "junior" else 7
    qs = []
    for _ in range(5):
        pairs = []
        same = _codes(rng, length)
        pairs.append(f"{same} – {same}")
        while len(pairs) < 4:
            a = _codes(rng, length)
            pairs.append(f"{a} – {_mutate(a, rng)}")
        qs.append(("Which pair is exactly the same on both sides?", pairs[0], pairs[1:]))
    for _ in range(3):
        digits = "".join(rng.choice("1234567890") for _ in range(16 if variant == "junior" else 24))
        target = rng.choice(digits)
        n = digits.count(target)
        spaced = " ".join(digits[i:i + 4] for i in range(0, len(digits), 4))
        wrong = [w for w in (n + 1, n - 1, n + 2, n + 3) if w >= 0 and w != n][:3]
        qs.append((f"How many times does the digit {target} appear in: {spaced}", str(n), [str(w) for w in wrong]))
    return qs


# ---------------------------------------------------------------- builders

APT_SECTIONS = {
    "junior": ["numerical", "verbal", "abstract", "spatial", "mechanical", "perceptual"],
    "standard": ["numerical", "verbal", "abstract", "spatial", "mechanical", "perceptual", "logical"],
    "adult": ["numerical", "verbal", "abstract", "spatial", "logical"],
}
SECTION_NAMES = {"numerical": "Numbers", "verbal": "Words", "abstract": "Patterns", "spatial": "Shapes and space",
                 "mechanical": "How things work", "perceptual": "Speed and accuracy", "logical": "Reasoning"}
SECTION_MINUTES = {"junior": 4, "standard": 5, "adult": 4}
PERCEPTUAL_MINUTES = 3


def _mcq(code, i, prompt, correct, distractors, rng):
    assert len(distractors) == 3 and correct not in distractors and len(set(distractors)) == 3, (code, prompt, correct, distractors)
    opts = [correct, *distractors]
    rng.shuffle(opts)
    return {"id": f"apt_{code[:3]}{i + 1}", "type": "mcq", "prompt": prompt, "scale": code, "key": opts.index(correct),
            "options": [{"value": j, "label": o} for j, o in enumerate(opts)]}


def aptitude(variant):
    rng = random.Random(f"aptitude-{variant}-{VERSION}")
    secs = []
    for code in APT_SECTIONS[variant]:
        src = {"numerical": lambda: numerical(variant, rng), "abstract": lambda: abstract(variant, rng),
               "perceptual": lambda: perceptual(variant, rng), "verbal": lambda: VERBAL[variant],
               "spatial": lambda: SPATIAL[variant], "mechanical": lambda: MECHANICAL[variant], "logical": lambda: LOGICAL[variant]}[code]()
        minutes = PERCEPTUAL_MINUTES if code == "perceptual" else SECTION_MINUTES[variant]
        secs.append({"code": code, "name": SECTION_NAMES[code], "time_limit_sec": minutes * 60,
                     "items": [_mcq(code, i, *q, rng) for i, q in enumerate(src)]})
    return dict(code="aptitude", name={"junior": "Brain games", "standard": "Aptitude", "adult": "Reasoning and aptitude"}[variant],
                items={"sections": secs},
                scoring_spec={"method": "aptitude", "subtests": APT_SECTIONS[variant],
                              "bands": [[0, 25, "Low"], [25, 75, "Average"], [75, 90, "High"], [90, 101, "Very High"]]},
                norms={b: {s["code"]: {"mean": round(len(s["items"]) * 0.55, 2), "sd": round(len(s["items"]) * 0.22, 2)} for s in secs} for b in BANDS},
                time_limit_min=sum(s["time_limit_sec"] for s in secs) // 60)


def interest(variant):
    src = {"junior": INTEREST_JR, "standard": INTEREST, "adult": INTEREST_ADULT}[variant]
    n = len(src["R"])
    options = LIKERT_JR if variant == "junior" else LIKERT_STD
    items = [{"id": f"int_{s}{i + 1}", "type": "likert5", "prompt": src[s][i], "scale": s, "options": options}
             for i in range(n) for s in RIASEC]
    return dict(code="interest", name={"junior": "What I like doing", "standard": "Interests", "adult": "Work interests"}[variant],
                items={"sections": [{"code": "main", "name": "Activities", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "riasec", "scales": RIASEC, "min": 1, "max": 5},
                norms=likert_norms(RIASEC, n), time_limit_min=None)


def bigfive(variant):
    src, sd, opts = (BIGFIVE_JR, SD_JR, AGREE_JR) if variant == "junior" else (BIGFIVE_STD, SD_STD, AGREE)
    n = len(src["O"])
    items = []
    for i in range(n):
        for d in "OCEAN":
            t, rev = src[d][i]
            items.append({"id": f"bf_{d}{i + 1}", "type": "likert5", "prompt": t, "scale": d, "reverse": rev, "options": opts})
    gap = len(items) // (len(sd) + 1)
    for i, t in enumerate(sd):
        items.insert(gap * (i + 1) + i, {"id": f"bf_SD{i + 1}", "type": "likert5", "prompt": t, "scale": "SD", "sd": True, "options": opts})
    norms = {b: {**{d: {"mean": 3.4, "sd": 0.7} for d in "OCEAN"}, "SD": {"mean": 2.6, "sd": 0.8}} for b in BANDS}
    return dict(code="bigfive", name="About me" if variant == "junior" else "Personality (Big Five)",
                items={"sections": [{"code": "main", "name": "About me", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "bigfive", "domains": list("OCEAN"), "score": "mean"},
                norms=norms, time_limit_min=None)


def workstyle(variant):
    junior = variant == "junior"
    src = WS_JR if junior else WS_STD
    items = [{"id": f"ws_{i + 1}", "type": "forced_choice", "prompt": "Pick the one MOST like you and the one LEAST like you",
              "options": [{"value": v, "label": t, "factor": f} for v, t, f in zip("abcd", tet, "RAPD")]}
             for i, tet in enumerate(src)]
    return dict(code="workstyle", name="How I like to work" if junior else "Work style",
                items={"sections": [{"code": "main", "name": "Most and least like me", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "workstyle", "factors": ["R", "A", "P", "D"],
                              "graphs": ["others", "self"] if junior else ["others", "stress", "self"], "range": 19},
                norms={}, time_limit_min=None)


def _spread(pairs):
    """Order pairs so no value appears in two consecutive items where possible."""
    out, left = [], list(pairs)
    while left:
        pick = next((p for p in left if not out or not set(p) & set(out[-1])), left[0])
        out.append(pick)
        left.remove(pick)
    return out


def values(variant):
    junior = variant == "junior"
    vals = VALUES_JR if junior else VALUES_STD
    pairs = _spread(list(combinations(range(len(vals)), 2)))
    items = [{"id": f"{'sv' if junior else 'val'}_{i + 1}", "type": "pair",
              "prompt": "Which is more important to you?" if junior else "Which matters more to you?",
              "options": [{"value": "a", "label": vals[a], "value_name": vals[a]},
                          {"value": "b", "label": vals[b], "value_name": vals[b]}]}
             for i, (a, b) in enumerate(pairs)]
    return dict(code="school_values" if junior else "values", name="What matters to me" if junior else "Work values",
                items={"sections": [{"code": "main", "name": "Choose one", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "values", "values": vals, "top": 5}, norms={}, time_limit_min=None)


def _likert_scales(code, name, src, opts, prefix):
    scales = list(src)
    n = len(src[scales[0]])
    items = [{"id": f"{prefix}_{s[:4]}{i + 1}", "type": "likert5", "prompt": src[s][i], "scale": s, "options": opts}
             for i in range(n) for s in scales]
    return dict(code=code, name=name, items={"sections": [{"code": "main", "name": name, "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "likert_scales", "scales": scales}, norms=likert_norms(scales, n), time_limit_min=None)


def learning(variant):
    return _likert_scales("learning", "How I learn", LEARNING_JR if variant == "junior" else LEARNING,
                          AGREE_JR if variant == "junior" else AGREE, "lrn")


def subject_enjoyment():
    items = [{"id": f"subj_{k}", "type": "likert5", "prompt": f"How much do you enjoy {v}?", "scale": k, "options": LIKERT_JR}
             for k, v in SUBJECTS.items()]
    return dict(code="subject_enjoyment", name="Subjects I enjoy",
                items={"sections": [{"code": "main", "name": "Subjects", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "likert_scales", "scales": list(SUBJECTS), "per_item": True}, norms={}, time_limit_min=None)


BATTERY = {
    "junior": [interest, subject_enjoyment, aptitude, bigfive, workstyle, values, learning],
    "standard": [interest, aptitude, bigfive, workstyle, values, learning],
    "adult": [interest, aptitude, bigfive, workstyle, values,
              lambda v: _likert_scales("career_anchors", "What I want from my career", CAREER_ANCHORS, AGREE, "anc"),
              lambda v: _likert_scales("adaptability", "Readiness for change", ADAPTABILITY, AGREE, "ada")],
}


def all_instruments():
    out = []
    for variant, builders in BATTERY.items():
        for b in builders:
            inst = b() if b is subject_enjoyment else b(variant)
            out.append({**inst, "track_variant": variant, "version": VERSION})
    return out


def item_count(inst):
    return sum(len(s["items"]) for s in inst["items"]["sections"])
