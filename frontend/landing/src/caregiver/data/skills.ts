import type { Skill } from "@/caregiver/types/skill";

export const skills: Skill[] = [
  {
    id: "bed-to-wheelchair",
    name: "Bed-to-Wheelchair Transfer",
    description: "Help a client move safely from bed into a wheelchair.",
    explanation:
      "You will show how you prepare the space, support the client, and complete a calm, controlled transfer into the wheelchair.",
    estimatedMinutes: 2,
    safetyReminder:
      "Practice with a colleague or training dummy — never ask a real client to help you record.",
    status: "ready_to_record",
    referenceVideo: "/videos/vehicle-transfer.mp4",
    steps: [
      {
        id: "brakes",
        label: "Lock the wheelchair brakes",
        detail: "Place the chair close to the bed and lock both brakes before you begin.",
      },
      {
        id: "gait-belt",
        label: "Secure the gait belt",
        detail: "Place the belt snugly around the client's waist and check that it is comfortable.",
      },
      {
        id: "posture",
        label: "Use a strong, safe stance",
        detail: "Bend your knees, keep a neutral back, and hold the client close.",
      },
      {
        id: "pivot",
        label: "Pivot with control",
        detail: "Guide a slow pivot and lower the client gently into the chair.",
      },
    ],
    coachingCues: [
      {
        atSeconds: 3,
        message: "Lock both wheelchair brakes before you start the transfer.",
      },
      {
        atSeconds: 8,
        message: "Remember to bend your knees and maintain a neutral back.",
      },
      {
        atSeconds: 14,
        message: "Keep the client close as you pivot — you're doing great.",
      },
    ],
    assessment: {
      summary:
        "You completed most of the transfer with care. One moment to keep practicing: lifting posture around 0:08.",
      encouragement:
        "This is helpful practice — a nurse will look at your recording and share the final decision.",
      steps: [
        { id: "brakes", label: "Wheelchair brakes locked", status: "passed" },
        { id: "gait-belt", label: "Gait belt secured", status: "passed" },
        {
          id: "posture",
          label: "Proper lifting posture",
          status: "needs_improvement",
          timestamp: "0:08",
        },
        { id: "pivot", label: "Controlled pivot", status: "passed" },
      ],
    },
  },
  {
    id: "gait-belt",
    name: "Gait Belt Assistance",
    description: "Place and use a gait belt to support a client while walking.",
    explanation:
      "You will demonstrate how you put on a gait belt, check the fit, and walk beside the client with a steady, supportive hold.",
    estimatedMinutes: 2,
    safetyReminder:
      "Keep one hand on the belt at all times during the walk, and stay on the client's weaker side.",
    status: "verified",
    steps: [
      {
        id: "explain",
        label: "Explain the step",
        detail: "Tell the client what you are doing before you place the belt.",
      },
      {
        id: "place",
        label: "Place the belt",
        detail: "Wrap the belt around the waist, over clothing, and fasten it snugly.",
      },
      {
        id: "check",
        label: "Check the fit",
        detail: "You should be able to slide two fingers under the belt.",
      },
      {
        id: "walk",
        label: "Walk with support",
        detail: "Stand slightly behind and to the side, holding the belt at the back.",
      },
    ],
    coachingCues: [
      {
        atSeconds: 4,
        message: "Check that you can slide two fingers under the belt.",
      },
      {
        atSeconds: 10,
        message: "Stay close and keep a relaxed, supportive hold.",
      },
    ],
    assessment: {
      summary:
        "You placed the belt carefully and stayed close throughout the walk. Beautiful, steady work.",
      encouragement:
        "A nurse has already reviewed this skill and marked it as verified.",
      steps: [
        { id: "explain", label: "Explained the step to the client", status: "passed" },
        { id: "place", label: "Belt placed over clothing", status: "passed" },
        { id: "check", label: "Fit checked with two fingers", status: "passed" },
        { id: "walk", label: "Supportive walking position", status: "passed" },
      ],
    },
  },
  {
    id: "assisted-standing",
    name: "Assisted Standing",
    description: "Help a client stand from a seated position with good body mechanics.",
    explanation:
      "You will show how you prepare the client, cue them to stand, and support them without lifting from the arms.",
    estimatedMinutes: 2,
    safetyReminder:
      "Never pull a client up by the arms or under the shoulders. Cue them to push from the chair.",
    status: "in_review",
    referenceVideo: "/videos/sit-to-stand.mp4",
    steps: [
      {
        id: "prepare",
        label: "Prepare the space",
        detail: "Place the client's feet flat on the floor and move the chair or bed into a stable position.",
      },
      {
        id: "cue",
        label: "Cue the stand",
        detail: "Count together and ask the client to lean forward and push up.",
      },
      {
        id: "support",
        label: "Support at the waist",
        detail: "Use a gait belt or a secure hold at the waist, not the arms.",
      },
      {
        id: "steady",
        label: "Steady at the top",
        detail: "Pause once standing so the client can find their balance.",
      },
    ],
    coachingCues: [
      {
        atSeconds: 5,
        message: "Cue the client to lean forward before standing.",
      },
      {
        atSeconds: 11,
        message: "Support at the waist — avoid pulling on the arms.",
      },
    ],
    assessment: {
      summary:
        "Your cues were clear and you waited for the client to find their balance. Nice, unhurried pacing.",
      encouragement:
        "Your assessment has been sent to a nurse for final review.",
      steps: [
        { id: "prepare", label: "Feet placed and space prepared", status: "passed" },
        { id: "cue", label: "Clear standing cue", status: "passed" },
        { id: "support", label: "Support at the waist", status: "passed" },
        {
          id: "steady",
          label: "Pause to find balance",
          status: "needs_improvement",
          timestamp: "0:12",
        },
      ],
    },
  },
  {
    id: "safe-positioning",
    name: "Safe Client Positioning",
    description: "Reposition a client in bed while protecting skin and joints.",
    explanation:
      "You will demonstrate how you turn and settle a client in bed, using pillows for support and keeping movements slow.",
    estimatedMinutes: 3,
    safetyReminder:
      "Raise the bed to a comfortable height for you, and keep the side rail up on the far side.",
    status: "not_started",
    referenceVideo: "/videos/bed-repositioning.mp4",
    steps: [
      {
        id: "height",
        label: "Adjust the bed height",
        detail: "Bring the bed to your waist level so you are not bending over.",
      },
      {
        id: "turn",
        label: "Turn with a draw sheet",
        detail: "Use a draw sheet and a partner or friction-reducing aid when possible.",
      },
      {
        id: "align",
        label: "Align the body",
        detail: "Keep the head, shoulders, and hips in a comfortable line.",
      },
      {
        id: "support",
        label: "Support with pillows",
        detail: "Place pillows to protect pressure points and keep the client comfortable.",
      },
    ],
    coachingCues: [
      {
        atSeconds: 4,
        message: "Raise the bed so you are not bending at the waist.",
      },
      {
        atSeconds: 12,
        message: "Move slowly and keep the client close to your body.",
      },
    ],
    assessment: {
      summary:
        "You moved with care and kept the client supported. Keep practicing pillow placement so pressure points stay protected.",
      encouragement:
        "Your assessment has been sent to a nurse for final review.",
      steps: [
        { id: "height", label: "Bed height adjusted", status: "passed" },
        { id: "turn", label: "Turned with a draw sheet", status: "passed" },
        {
          id: "align",
          label: "Body alignment",
          status: "needs_improvement",
          timestamp: "0:10",
        },
        { id: "support", label: "Pillows placed for support", status: "passed" },
      ],
    },
  },
  {
    id: "wheelchair-safety",
    name: "Wheelchair Safety",
    description: "Set up a wheelchair so a client can sit, ride, and transfer safely.",
    explanation:
      "You will show how you inspect the chair, lock the brakes, place the footrests, and help the client sit securely.",
    estimatedMinutes: 2,
    safetyReminder:
      "Always lock the brakes before a client sits or stands, even for a short pause.",
    status: "verified",
    referenceVideo: "/videos/wheelchair.mp4",
    steps: [
      {
        id: "inspect",
        label: "Inspect the chair",
        detail: "Check tires, brakes, and that the seat is clear and dry.",
      },
      {
        id: "lock",
        label: "Lock the brakes",
        detail: "Lock both brakes before anyone sits or stands.",
      },
      {
        id: "footrests",
        label: "Position the footrests",
        detail: "Swing footrests out of the way, then place the client's feet once seated.",
      },
      {
        id: "seatbelt",
        label: "Settle and secure",
        detail: "Help the client sit all the way back and fasten a seatbelt if used.",
      },
    ],
    coachingCues: [
      { atSeconds: 3, message: "Lock both brakes before the client sits." },
      { atSeconds: 9, message: "Make sure the client is sitting all the way back." },
    ],
    assessment: {
      summary:
        "You checked the chair, locked the brakes, and helped the client sit securely. This was calm and complete.",
      encouragement:
        "A nurse has already reviewed this skill and marked it as verified.",
      steps: [
        { id: "inspect", label: "Chair inspected", status: "passed" },
        { id: "lock", label: "Brakes locked", status: "passed" },
        { id: "footrests", label: "Footrests positioned", status: "passed" },
        { id: "seatbelt", label: "Client seated securely", status: "passed" },
      ],
    },
  },
];

export function getSkillById(id: string) {
  return skills.find((skill) => skill.id === id);
}

export function getRecommendedSkill(list: Skill[] = skills) {
  return (
    list.find((skill) => skill.status === "ready_to_record") ??
    list.find((skill) => skill.status === "not_started") ??
    list[0]
  );
}
