import { Button } from "./components/ui/button";
import { Card, CardHeader } from "./components/ui/card";

function App() {
    return (
      <Card className="p-6 rounded-lg shadow-lg max-w-sm text-center">
          <CardHeader className="text-2xl font-bold">Tailwind Card</CardHeader>
          <p className="mt-3">
              This is a simple card layout built with Tailwind CSS.
          </p>
          <Button variant="default" className="font-bold py-2 px-4 rounded mt-4">
              Learn More
          </Button>
      </Card>
    );
  }
  
  export default App;