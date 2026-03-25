export const QUESTIONS = [
  {
    id: 1,
    text: "How often do you read ingredient labels when grocery shopping?",
    options: [
      { label: "A", text: "Never", score: 1 },
      { label: "B", text: "Rarely", score: 2 },
      { label: "C", text: "Sometimes", score: 3 },
      { label: "D", text: "Usually", score: 4 },
      { label: "E", text: "Always", score: 5 }
    ]
  },
  {
    id: 2,
    text: "How much of your diet comes from processed or packaged foods?",
    options: [
      { label: "A", text: "Most of it — convenience is key", score: 1 },
      { label: "B", text: "About half and half", score: 2 },
      { label: "C", text: "I try to minimize it", score: 4 },
      { label: "D", text: "Very little — I cook from scratch", score: 5 }
    ]
  },
  {
    id: 3,
    text: "When you buy produce, what matters most to you?",
    options: [
      { label: "A", text: "Price — I buy what's affordable", score: 1 },
      { label: "B", text: "Convenience — whatever's easy to grab", score: 2 },
      { label: "C", text: "I look for organic when possible", score: 3 },
      { label: "D", text: "Organic is my default", score: 4 }
    ]
  },
  {
    id: 4,
    text: "How familiar are you with GMOs and their presence in the food supply?",
    options: [
      { label: "A", text: "Not very familiar", score: 1 },
      { label: "B", text: "Somewhat — I've heard about it", score: 3 },
      { label: "C", text: "Very familiar — I actively avoid them", score: 4 }
    ]
  },
  {
    id: 5,
    text: "How often do you eat at fast food or chain restaurants?",
    options: [
      { label: "A", text: "Multiple times a week", score: 1 },
      { label: "B", text: "About once a week", score: 2 },
      { label: "C", text: "A few times a month", score: 1 },
      { label: "D", text: "Rarely", score: 2 },
      { label: "E", text: "Never", score: 0 }
    ]
  },
  {
    id: 6,
    text: "Do you currently take any steps to reduce your exposure to pesticides?",
    options: [
      { label: "A", text: "No, I don't think about it much", score: 0 },
      { label: "B", text: "I wash my produce thoroughly", score: 1 },
      { label: "C", text: "I buy some organic, especially the Dirty Dozen", score: 1 },
      { label: "D", text: "I buy mostly or all organic", score: 2 }
    ]
  },
  {
    id: 7,
    text: "Where do you currently get most of your food?",
    options: [
      { label: "A", text: "Fast food / convenience stores", score: 0 },
      { label: "B", text: "Conventional grocery stores", score: 0 },
      { label: "C", text: "A mix of conventional and natural grocery stores", score: 1 },
      { label: "D", text: "Primarily natural/health food stores", score: 2 },
      { label: "E", text: "Farmers markets and local farms", score: 3 },
      { label: "F", text: "Largely from my own garden or homestead", score: 4 }
    ]
  },
  {
    id: 8,
    text: "Have you ever done an elimination diet or food sensitivity protocol?",
    options: [
      { label: "A", text: "No, never", score: 0 },
      { label: "B", text: "I've thought about it", score: 0 },
      { label: "C", text: "I've tried something similar", score: 0 },
      { label: "D", text: "Yes, I've done a full protocol", score: 3 },
      { label: "E", text: "I follow a specific therapeutic diet", score: 0 }
    ]
  },
  {
    id: 9,
    text: "How connected do you feel to where your food comes from?",
    options: [
      { label: "A", text: "Not at all — food just appears at the store", score: 0 },
      { label: "B", text: "A little — I think about it occasionally", score: 0 },
      { label: "C", text: "Somewhat — I try to buy local when I can", score: 1 },
      { label: "D", text: "Very — I know my farmers personally", score: 3 },
      { label: "E", text: "Completely — I grow or raise much of my own food", score: 3 }
    ]
  },
  {
    id: 10,
    text: "How do you feel about seed oils (canola, soybean, sunflower, corn oil)?",
    options: [
      { label: "A", text: "I use them regularly without concern", score: 0 },
      { label: "B", text: "I've heard concerns but haven't changed my habits", score: 0 },
      { label: "C", text: "I actively avoid them and use alternatives", score: 3 }
    ]
  },
  {
    id: 11,
    text: "How important is food to your overall health philosophy?",
    options: [
      { label: "A", text: "Food is fuel — I don't overthink it", score: 0 },
      { label: "B", text: "I know diet matters but it's one of many factors", score: 2 },
      { label: "C", text: "Food is medicine — it's central to my health", score: 3 },
      { label: "D", text: "I follow a specific dietary philosophy", score: 0 },
      { label: "E", text: "Food sovereignty and real food is my life mission", score: 5 }
    ]
  },
  {
    id: 12,
    text: "Have you ever grown any of your own food?",
    options: [
      { label: "A", text: "Yes — a garden, homestead, or even a few herbs", score: 5 },
      { label: "B", text: "No, not yet", score: 0 }
    ]
  },
  {
    id: 13,
    text: "Do you know what regenerative agriculture is?",
    options: [
      { label: "A", text: "Yes — and I actively seek out regeneratively grown food", score: 4 },
      { label: "B", text: "Not really", score: 0 }
    ]
  }
];

export const STAGES = [
  { stage: 1, min: 4, max: 13, name: "Processed Food", message: "You're exactly where most people start — and the fact that you're here means you're already ahead of the curve. We're not going to overwhelm you. We're going to show you the three biggest changes that will make the biggest difference. One bite at a time." },
  { stage: 2, min: 14, max: 24, name: "Higher Quality Processed Food", message: "You're paying attention — and that matters more than you know. You've started reading labels, looking for organic options, making conscious choices. Now we're going to show you what the labels aren't telling you. The next layer goes deeper." },
  { stage: 3, min: 25, max: 33, name: "Whole Food Shopper", message: "You've done the work most people never do. Whole foods, real ingredients, conscious sourcing — you're living it. Where we go from here is about the soil those foods grew in and the farmer who grew them. The bridge between your grocery store and your local farm is closer than you think." },
  { stage: 4, min: 34, max: 42, name: "Locally Grown", message: "You already understand something most people are just beginning to discover — that the relationship between you and your food matters. You know your farmer, or you're working toward it. We're going to help you deepen those connections and fill the gaps." },
  { stage: 5, min: 43, max: 49, name: "Home Grown", message: "You've already arrived at what most people are searching for. A garden, a farm, real food sovereignty — you're living the mission. Beyond Labels for you is about community, teaching others, and going even deeper into the homestead life. Joel's got a lot to show you." }
];

export function getStageFromScore(score) {
  return STAGES.find(s => score >= s.min && score <= s.max) || STAGES[0];
}
